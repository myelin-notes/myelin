// Both, in this order, exactly as the app's src/index.css does it. The editor
// stylesheet reads shared tokens (--bg-card, --shadow-rgb, --border-ghost) that
// live in the UI theme and are the host's job to supply. Without them the page
// sheet renders with no fill, no border, and no box-shadow — so the bench would
// quietly measure a cheaper page frame than the app ever draws.
import '@myelin/ui/theme.css';
import '@myelin/editor/styles.css';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { applyDprOverride, type BenchConfig, readConfig } from './config';
import { mountPageFrameDomLayer } from './dom-layer';
import { makeInputStep } from './input';
import { initBenchPlatform } from './platform';
import { installRafProbe, rafTotalMs } from './raf-probe';
import { postResult } from './report';
import { buildScene } from './scenes';
import { installSecureContextShims } from './secure-context-shim';
import { type BenchResult, Series, summarize } from './stats';
import {
  advanceSuite,
  beginSuiteCase,
  clearSuite,
  formatSuite,
  SUITE_DEFAULTS,
  type SuiteOutcome,
  suiteRows,
} from './suite';

declare global {
  interface Window {
    /** Set once the run finishes. The driver polls for this. */
    __benchResult?: BenchResult & { config: BenchConfig };
    __benchError?: string;
  }
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`bench: #${id} missing from index.html`);
  }
  return element as T;
}

/**
 * Drop the layers this scenario does not use.
 *
 * Removal, not hiding: `display:none` would take the layer out of the
 * compositor too, but leaving the node around invites the renderer to keep
 * sizing it. Removing it makes "this layer does not exist" unambiguous.
 */
function mountLayers(canvas: DrawableCanvas, config: BenchConfig): void {
  const bg = requireElement<HTMLElement>('bg');
  const overlay = requireElement<HTMLCanvasElement>('overlay');

  if (config.layers === 'fg') {
    bg.remove();
    overlay.remove();
    return;
  }
  canvas.setBackgroundHost(bg);
  if (config.layers === 'fg+bg') {
    overlay.remove();
    return;
  }
  canvas.setOverlayCanvas(overlay);
}

function formatReadout(config: BenchConfig, result: BenchResult): string {
  const n = (v: number) => v.toFixed(2);
  return [
    `scene ${config.scene}(${config.strokes}x${config.points})  layers ${config.layers}  dpr ${config.dpr}  input ${config.input}`,
    `frames ${result.frames}  fps ${result.fps.toFixed(1)}`,
    `frame  mean ${n(result.frameMean)}  p50 ${n(result.frameP50)}  p95 ${n(result.frameP95)}  p99 ${n(result.frameP99)}`,
    `js     mean ${n(result.jsMean)}  p95 ${n(result.jsP95)}`,
    `otherJs mean ${n(result.otherJsMean)}  (other animation loops)`,
    `browser mean ${n(result.browserMean)}`,
  ].join('\n');
}

/**
 * Records the outcome of the current suite case and moves to the next, or
 * finishes the sweep. Set by `run()` once it knows a suite is in progress, so
 * the top-level error handler can close out a case that threw.
 */
let completeSuiteCase: (outcome: SuiteOutcome) => void = () => {};

function run(): void {
  // Before the engine can reach for anything a secure context would have, and
  // before any loop registers a callback the probe would otherwise miss.
  installSecureContextShims();
  installRafProbe();

  const params = new URLSearchParams(window.location.search);
  const suiteName = params.get('suite');
  const suite = suiteName
    ? beginSuiteCase(suiteName, Number(params.get('repeat')) || undefined)
    : null;
  if (suiteName && !suite) {
    throw new Error(`bench: no suite named "${suiteName}"`);
  }
  // The suite's case overrides whatever the URL asked for; everything else in
  // the URL (duration, warmup) still applies to every case in the sweep.
  if (suite) {
    // Suite-wide defaults first, then the case's own — so the first case gets
    // the same fixed scene the later ones inherit through their next-URL.
    for (const [key, value] of Object.entries({
      ...(SUITE_DEFAULTS[suiteName as string] ?? {}),
      ...suite.case.params,
    })) {
      params.set(key, value);
    }
  }

  const config = readConfig(params.toString());
  // Emit a user-timing mark per measured frame, so a Chrome trace can find the
  // measured window and count frames in it. Off unless asked for: a mark is
  // cheap but not free, and every other run's numbers should describe the app
  // rather than the app plus an instrument.
  const markFrames = params.get('mark') === '1';
  const readout = requireElement('readout');
  if (suite) {
    readout.textContent = `running: ${suite.case.label} (run ${suite.state.current.length + 1}/${suite.state.repeat})`;
    completeSuiteCase = (outcome) => {
      const next = advanceSuite(suite.state, outcome, {
        warmup: String(config.warmupMs),
        duration: String(config.durationMs),
        repeat: String(suite.state.repeat),
      });
      if (next) {
        window.location.href = next;
        return;
      }
      // Render before clearing: the table is the whole point of the sweep, and
      // it has to survive on screen for someone to read it off a tablet.
      const rows = suiteRows(suite.state.name);
      const text = formatSuite(rows);
      readout.textContent = text;
      postResult({ text, rows });
      clearSuite();
    };
  }

  // Before anything sizes a backing store.
  applyDprOverride(config.dpr);
  // The renderer reads this pref in its constructor and caches the pattern, so
  // it has to be in place before the canvas is built.
  UserPrefs.set('canvasBackground', config.background);
  initBenchPlatform();

  const fg = requireElement<HTMLCanvasElement>('fg');
  const ydoc = new YDocManager();
  const canvas = new DrawableCanvas(fg, ydoc);
  mountLayers(canvas, config);
  canvas.setDomOverlayHost(requireElement('dom-overlay'));
  buildScene(canvas, config);
  if (config.domLayer) {
    // After the scene, so the layer's first sync sees the frames that exist
    // rather than creating their containers a frame late.
    mountPageFrameDomLayer(requireElement('page-frame-layer'), canvas);
  }

  const step = makeInputStep(canvas, config.input);

  const frameSeries = new Series();
  const jsSeries = new Series();
  let frame = 0;
  let measuringSince = 0;
  // Animation-frame time already banked before measurement began, subtracted
  // out so warmup does not count against the measured window.
  let rafAtMeasureStart = 0;
  const startedAt = performance.now();

  // The engine's own loop is the code under test, so drive it rather than
  // reimplementing rAF here. It hands `redraw` the frame gap in seconds, which
  // is the wall-clock measurement we want — including whatever the compositor
  // spent after the previous frame returned.
  const stop = startDrawableCanvasAnimationLoop(
    {
      redraw: (deltaTime: number) => {
        step(frame);
        const before = performance.now();
        canvas.redraw(deltaTime);
        const jsMs = performance.now() - before;

        const elapsed = before - startedAt;
        if (elapsed >= config.warmupMs) {
          if (measuringSince === 0) {
            // First measured frame: its gap spans the warmup boundary and the
            // scene build, so it is not a sample of steady state.
            measuringSince = before;
            rafAtMeasureStart = rafTotalMs();
          } else {
            frameSeries.push(deltaTime * 1000);
            jsSeries.push(jsMs);
          }
          if (markFrames) {
            performance.mark('bench-frame');
          }
        }
        frame++;
      },
    },
    () => {},
  );

  const finish = () => {
    stop();
    if (frameSeries.count === 0) {
      // Zeros are indistinguishable from a real result once they are in a
      // table, and this is the shape every "the run produced nothing" bug
      // takes — a throttled background tab, a warmup longer than the run.
      throw new Error(
        `bench: no frames measured in ${config.durationMs}ms. The animation loop did not run — check that the window is visible and not backgrounded.`,
      );
    }
    const result = summarize(
      frameSeries,
      jsSeries,
      rafTotalMs() - rafAtMeasureStart,
    );
    window.__benchResult = { ...result, config };

    if (!suite) {
      readout.textContent = formatReadout(config, result);
      return;
    }
    completeSuiteCase({ result });
  };

  // `finish` runs from a timer, so a throw inside it would escape the guard
  // around `run()` and leave the page showing "running…" forever — and in a
  // suite, silently stall the sweep.
  window.setTimeout(
    () => reportErrors(finish),
    config.warmupMs + config.durationMs,
  );
}

/**
 * Surface a failure where both the driver and a tablet screen can see it, and
 * keep a suite moving past the case that failed.
 */
function reportErrors(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    const message =
      error instanceof Error ? error.stack || error.message : String(error);
    window.__benchError = message;
    const readout = document.getElementById('readout');
    if (readout) {
      readout.textContent = message;
    }
    // No-op outside a suite, which leaves the message on screen for the driver
    // (and for anyone running a single case by hand) to pick up.
    completeSuiteCase({ error: message });
  }
}

reportErrors(run);
