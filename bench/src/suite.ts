import type { BenchResult } from './stats';

/**
 * A run of several configurations back to back, driven by the page itself.
 *
 * The CDP driver cannot reach a tablet, and a tablet is where the numbers that
 * matter are. Each case is a full page load — layers are mounted once and the
 * pixel ratio is patched before anything is sized, so they cannot be varied
 * within a load — with the queue and the accumulated results carried in
 * sessionStorage. The device runs the whole sweep from one tap.
 */
export interface SuiteCase {
  label: string;
  params: Record<string, string>;
}

/**
 * A finished case: either measurements, or why it produced none.
 *
 * A case that throws must not take the sweep down with it. On a tablet the
 * whole run is one tap and several page loads, so losing six good rows because
 * the seventh hit an unsupported API means starting over with no record of
 * what failed.
 */
export type SuiteOutcome = { result: BenchResult } | { error: string };

export type SuiteRow = { label: string; spread?: number } & SuiteOutcome;

const STORAGE_KEY = 'myelin-bench-suite';

/**
 * The default sweep, ordered so each row differs from the one above it in
 * exactly one respect. Reading it top to bottom attributes cost to each change.
 *
 * `dpr` is left unset on all but one case so the device measures itself at its
 * own pixel ratio; the explicit `dpr=1` case is what quantifies the cap that
 * tablet builds apply.
 */
export const SUITES: Record<string, SuiteCase[]> = {
  layers: [
    { label: 'fg only, blank', params: { layers: 'fg', bg: 'blank' } },
    { label: '+bg layer, blank', params: { layers: 'fg+bg', bg: 'blank' } },
    { label: '+overlay layer, blank', params: { layers: 'all', bg: 'blank' } },
    { label: 'all layers, dots', params: { layers: 'all', bg: 'dots' } },
    {
      label: 'all layers, dots, idle',
      params: { layers: 'all', bg: 'dots', input: 'idle' },
    },
    {
      label: 'all layers, dots, dpr 1',
      params: { layers: 'all', bg: 'dots', dpr: '1' },
    },
    {
      label: 'all layers, dots, 200 strokes',
      params: { layers: 'all', bg: 'dots', scene: 'strokes', strokes: '200' },
    },
  ],

  /**
   * Why the app is slower than the canvas renderer alone.
   *
   * On-device the renderer with no elements already beat what the real app
   * manages with one or two, so the cost is in something the canvas-only bench
   * does not have. Each rung adds one of those things. The rung where the
   * number falls off is the answer; every rung holds layers, background, and
   * pixel ratio fixed so nothing else can explain a drop.
   */
  gap: [
    {
      label: 'canvas only (baseline)',
      params: { layers: 'all', bg: 'dots' },
    },
    {
      label: '+ react dom layer, no pages',
      params: { layers: 'all', bg: 'dots', domLayer: '1' },
    },
    {
      label: '+ 1 page frame, no dom layer',
      params: { layers: 'all', bg: 'dots', scene: 'pageframe', pages: '1' },
    },
    {
      label: '+ 1 page frame, dom layer',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
      },
    },
    {
      label: '+ 3 page frames, dom layer',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '3',
        domLayer: '1',
      },
    },
  ],

  /**
   * Where a *moving* frame's time goes, in the app's real configuration.
   *
   * Skipping frames on which nothing changed does not make anything smoother —
   * it only stops the counter from reporting the cost. The frames that decide
   * whether panning feels good are the ones where the view moved, so every
   * case here pans, over a page frame with ink on it.
   *
   * Run at dpr 3 on purpose. iOS caps rAF at 60fps, so anything cheaper than
   * 16.67ms reads as exactly 16.67ms and cannot be told apart from anything
   * else that fits. Tripling the pixel count puts every case above that floor;
   * cost scales with pixels, so the *shares* still describe dpr 2.
   */
  moving: [
    {
      label: 'fg only, blank',
      params: { layers: 'fg', bg: 'blank' },
    },
    {
      label: '+ bg layer, blank',
      params: { layers: 'fg+bg', bg: 'blank' },
    },
    {
      label: '+ dot pattern',
      params: { layers: 'fg+bg', bg: 'dots' },
    },
    {
      label: '+ overlay layer',
      params: { layers: 'all', bg: 'dots' },
    },
    {
      label: '+ page frame dom sync (= the app)',
      params: { layers: 'all', bg: 'dots', domLayer: '1' },
    },
  ],

  /**
   * The same attribution for a zoom, which is the one gesture that repaints.
   *
   * A pan is a translate of layers that already exist, so it rasterizes
   * nothing. A zoom changes their scale, and everything sized in screen pixels
   * has to be repainted at the new one. The rows separate the two things that
   * do that: the background tiling, and the page-frame chrome.
   *
   * The first two rows no longer differ, and are kept as the check that they
   * don't. The background layer is now taken out of the tree for the length of
   * a zoom — it is wider than the viewport, so it is tiled, and a tiled layer
   * is re-rasterized as its contents scale drifts no matter what size its
   * pattern is painted at. So `blank` and `dots` are the same layer state here,
   * and the `bgRaster` knob decides nothing during this gesture. A gap opening
   * up between these two rows means the takedown stopped working.
   */
  zoom: [
    { label: 'canvas only, blank', params: { layers: 'all', bg: 'blank' } },
    {
      label: '+ dot background (should match)',
      params: { layers: 'all', bg: 'dots' },
    },
    {
      label: '+ 1 page frame',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
      },
    },
    {
      label: '  same, no page shadow',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
        frameShadow: 'off',
      },
    },
    {
      label: '  same, chrome not promoted',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
        chromePromoted: '0',
      },
    },
    // Dropping the shadow saves 7.69ms and dropping the promotion saves
    // 7.77ms, separately. Either they are two names for one cost — a promoted
    // layer being resized has to repaint whole, and the most expensive thing in
    // that repaint is the shadow — or they are independent and stack. One row
    // decides it, and the answer decides whether there is anything left to find
    // after those two.
    {
      label: '  same, neither',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
        frameShadow: 'off',
        chromePromoted: '0',
      },
    },
    // A page-sized white rectangle costs 0.4ms even resized and promoted every
    // frame, so neither the element, its size, nor how it follows the view can
    // explain 14.63ms. That leaves what is inside, and the largest thing inside
    // is a live contenteditable carrying the editor's whole stylesheet — over
    // an empty document, which ought to be free.
    {
      label: '  same, and no editor',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
        frameShadow: 'off',
        chromePromoted: '0',
        frameEditor: '0',
      },
    },
    {
      label: '  editor hidden only',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '1',
        domLayer: '1',
        frameEditor: '0',
      },
    },
    // The last two rows are one question, asked of a rectangle instead of a
    // page frame: does a promoted layer repaint because its transform scale
    // changed, with nothing about its layout changing?
    //
    // That is what the shipped chrome now does between zoom steps, and an iPad
    // timeline says the subtree still repaints on 56 of 60 zoom frames — 42.0ms
    // of compositing on those against 8.4ms on the four that do not — with no
    // style recalc or layout in the subtree to explain it. If that is the
    // residual scale, `stepped` costs what a repaint costs and `held` does not,
    // and laying the chrome out at steps cannot be made to work as designed.
    // If the two read the same, the repaint has some other cause and the page
    // frame rows above are where to keep looking.
    //
    // No page frame in the scene: the rectangle is the only page-sized thing on
    // screen, so nothing else can absorb or explain the difference.
    //
    // Do not read this pair locally — it has been run. Chromium's compositor
    // holds a raster scale across a changing transform and only re-rasters once
    // the scale has drifted far enough, which is the behaviour in question, so
    // the backend cannot rule it in or out. At one rect it reported no gap at
    // all (2.33 vs 2.16 `DisplayItemList::Raster` per frame); at eight it leans
    // the right way but nowhere near enough to call (8.88 vs 7.38, with the
    // milliseconds inside the noise). This pair is for the device.
    // Eight stacked rects, not one. The first device run put both at 16.65 and
    // 16.66 with spreads of 0.02 and 0.00 — the 60fps cap, which reports that
    // one page-sized rect is cheap and nothing else. Stacking them multiplies
    // the raster without moving the geometry, so the pair clears the cap and
    // the difference between them, if there is one, has room to show. Override
    // with `?pages=16` on the URL if eight still reads 16.6x; no rebuild.
    //
    // ANSWERED, NO: 19.04ms rescaled against 18.82ms never rescaled, inside a
    // 2.11ms spread, and both only ~2.2ms above the blank-canvas baseline's
    // paint. Rescaling a promoted layer every frame costs nothing here.
    //
    // Kept, because the answer is only as wide as the control. These rects are
    // leaves. The chrome root wraps an inner viewport carrying `zoom:
    // devicePixelRatio` and a nested `scale()`, and holding that crisp across a
    // changing ancestor scale is not the same job as holding a flat fill crisp.
    // The last pair below asks the same question of the real subtree.
    {
      label: '  8 rects, stepped + rescaled (= the chrome)',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'empty',
        plainFrame: 'stepped',
        pages: '8',
      },
    },
    {
      label: '  8 rects, stepped, never rescaled',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'empty',
        plainFrame: 'held',
        pages: '8',
      },
    },
    // The same question, asked of the real subtree instead of a rectangle.
    //
    // Three frames rather than one for the same reason the rects are stacked:
    // one page frame reads 16.9ms, which is the cap and not a measurement.
    // Three was 41.98ms when it was last measured on this device, so the pair
    // has room.
    //
    // The second row keeps the layout on zoom steps and takes the residual off
    // the root's transform, so nothing about the subtree changes between steps
    // at all. It renders up to 41% small and snaps at each step — wrong on
    // screen, and the point.
    {
      label: '+ 3 page frames',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '3',
        domLayer: '1',
      },
    },
    {
      label: '  same, chrome never rescaled',
      params: {
        layers: 'all',
        bg: 'dots',
        scene: 'pageframe',
        pages: '3',
        domLayer: '1',
        chromeRescaled: '0',
      },
    },
  ],
};

/**
 * Params applied to every case in a suite, before the case's own.
 *
 * `moving` fixes the scene and pixel ratio across all of its rows: the point is
 * to attribute one frame's cost to its parts, so everything except the part
 * under test has to be identical.
 */
export const SUITE_DEFAULTS: Record<string, Record<string, string>> = {
  moving: {
    scene: 'note',
    pages: '1',
    strokes: '200',
    input: 'pan',
    dpr: '3',
  },
  // Deliberately NOT dpr 3, which is what `moving` uses to get above the 60fps
  // rAF cap. On an iPad that overshoots into WebKit's canvas-memory threshold,
  // where 2D contexts stop being accelerated: cost then scales with the number
  // of canvases rather than what is drawn, `js` jumps by an order of magnitude,
  // and adding a *blank* layer doubles the frame. A run there measures the
  // cliff, not the gesture. Zoom does not need the trick anyway — it is already
  // far enough below 60fps at the device's own pixel ratio to be resolvable.
  //
  // A row reading exactly 16.6x has hit the cap and only means "fast enough";
  // it does not report its headroom.
  zoom: {
    input: 'zoom',
  },
};

/**
 * Repeats per case, with the median reported.
 *
 * A single run per case was enough while the effects being measured were
 * 8-12ms. It stopped being enough once they were not: two runs of an identical
 * configuration came back 16.90ms and 21.28ms, a spread wider than every
 * difference the sweep was trying to resolve. The CDP driver has always taken a
 * median of repeats; the device suite now does the same, and reports the spread
 * so a result that is really noise is visible as noise.
 */
const DEFAULT_REPEAT = 3;

interface SuiteState {
  name: string;
  index: number;
  repeat: number;
  /** Results for the case in progress, until it has been run `repeat` times. */
  current: BenchResult[];
  rows: SuiteRow[];
}

function readState(): SuiteState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SuiteState) : null;
  } catch {
    return null;
  }
}

function writeState(state: SuiteState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearSuite(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * The case this page load should run, starting the suite if it is not already
 * in progress. Returns null when `name` is not a known suite.
 */
export function beginSuiteCase(
  name: string,
  repeat = DEFAULT_REPEAT,
): { state: SuiteState; case: SuiteCase } | null {
  const cases = SUITES[name];
  if (!cases) {
    return null;
  }
  const existing = readState();
  const state =
    existing && existing.name === name
      ? existing
      : {
          name,
          index: 0,
          repeat: Math.max(1, Math.floor(repeat)),
          current: [],
          rows: [],
        };
  return { state, case: cases[state.index] };
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

/**
 * Record a finished run and hand back the next URL, or null when the suite is
 * complete. Shared params (duration, warmup) ride along so the whole sweep uses
 * the settings the first URL asked for.
 *
 * A case is repeated until it has `repeat` results, then collapses to the
 * median. A case that throws is not retried — it would only throw again — and
 * is recorded as failed so the rest of the sweep still finishes.
 */
export function advanceSuite(
  state: SuiteState,
  outcome: SuiteOutcome,
  shared: Record<string, string>,
): string | null {
  const cases = SUITES[state.name];

  if ('error' in outcome) {
    state.rows.push({ label: cases[state.index].label, error: outcome.error });
    state.current = [];
    state.index += 1;
  } else {
    state.current.push(outcome.result);
    if (state.current.length >= state.repeat) {
      const means = state.current.map((r) => r.frameMean);
      const mid = median(means);
      // Report the run that *is* the median rather than averaging fields
      // across runs that disagree, so every number in a row is self-consistent.
      const chosen =
        state.current.find((r) => r.frameMean === mid) ?? state.current[0];
      state.rows.push({
        label: cases[state.index].label,
        result: chosen,
        spread: Math.max(...means) - Math.min(...means),
      });
      state.current = [];
      state.index += 1;
    }
  }

  writeState(state);
  if (state.index >= cases.length) {
    return null;
  }
  const params = new URLSearchParams({
    ...shared,
    ...(SUITE_DEFAULTS[state.name] ?? {}),
    ...cases[state.index].params,
    suite: state.name,
  });
  return `${window.location.pathname}?${params}`;
}

export function suiteRows(name: string): SuiteRow[] {
  const state = readState();
  return state && state.name === name ? state.rows : [];
}

/** Fixed-width table of a finished suite, for reading straight off a tablet. */
export function formatSuite(rows: SuiteRow[]): string {
  const width = Math.max(...rows.map((r) => r.label.length));
  const header = `${'case'.padEnd(width)}   fps   frame  spread     p95      js   other  layout   paint`;
  const body = rows.map((row) => {
    if (!('result' in row)) {
      // First line only: a stack would push the surviving rows off a tablet
      // screen. The full text goes to the sink with the rest of the payload.
      return `${row.label.padEnd(width)}  FAILED: ${row.error.split('\n')[0]}`;
    }
    const { result } = row;
    return [
      row.label.padEnd(width),
      result.fps.toFixed(0).padStart(5),
      result.frameMean.toFixed(2).padStart(7),
      (row.spread === undefined ? '-' : row.spread.toFixed(2)).padStart(7),
      result.frameP95.toFixed(2).padStart(7),
      result.jsMean.toFixed(2).padStart(7),
      result.otherJsMean.toFixed(2).padStart(7),
      result.layoutMean.toFixed(2).padStart(7),
      result.browserMean.toFixed(2).padStart(7),
    ].join(' ');
  });
  return [header, '-'.repeat(header.length), ...body].join('\n');
}
