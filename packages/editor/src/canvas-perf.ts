/**
 * Per-frame timing for the canvas render path.
 *
 * The question this exists to answer: when the canvas runs at 40fps, is the
 * 25ms going into our JavaScript, or into WebKit's paint and compositing after
 * we return? Those have opposite fixes — do less work per frame, versus ask the
 * browser to composite something cheaper — and on a sideloaded iPad there is no
 * Safari Web Inspector to tell them apart.
 *
 * `frame` is the wall-clock gap between animation frames. `js` is how long our
 * redraw took inside that gap, and `input` how long pointer handling took (it
 * runs in event listeners, outside the redraw, so it would otherwise be
 * invisible — and while drawing it is not small). Whatever is left is the
 * browser: layout, paint, rasterization, compositing, GC. A large `frame` with
 * a small `js` and `input` means the cost is not in code we can make faster by
 * doing less of it.
 *
 * Caveat worth remembering when reading the numbers: canvas 2D calls are
 * recorded into a display list and rasterized later, so the cost of a heavy
 * `fillRect` shows up in the gap, not in `js`.
 */

import { renderScale } from './render-scale';

/**
 * Frames retained per metric. At 20fps this is ~15 seconds of history, enough
 * that a trace copied straight after a pan covers the whole gesture.
 */
const WINDOW = 300;

/**
 * `*Paint` metrics are 0/1 per redraw rather than milliseconds: the share of
 * frames on which that layer actually cleared and repainted. They exist because
 * the ms metrics cannot answer the question that matters here — issuing the
 * draw calls is nearly free, and the real cost is that touching a full-viewport
 * layer at all forces a re-rasterize and texture upload after we return. So the
 * count of layers touched per frame predicts the frame time; the time spent
 * inside the layer's callback does not.
 */
export type CanvasPerfMetric =
  | 'frame'
  | 'js'
  | 'input'
  | 'pageFrame'
  | 'bg'
  | 'fg'
  | 'overlay'
  | 'dom'
  | 'bgPaint'
  | 'fgPaint'
  | 'overlayPaint';

const METRICS: CanvasPerfMetric[] = [
  'frame',
  'js',
  'input',
  'pageFrame',
  'bg',
  'fg',
  'overlay',
  'dom',
  'bgPaint',
  'fgPaint',
  'overlayPaint',
];

/**
 * Metrics sampled once per animation frame by the render loop rather than at
 * the point they are measured.
 *
 * Everything except `frame` and `js` is gathered somewhere that does not run
 * on every frame — phases are skipped when a layer does not repaint, input
 * arrives in event handlers, the page-frame layer runs its own loop. Recording
 * at the measurement point left each series a different length, so a trace
 * could not be read across rows: you could not line a 40ms frame up against
 * what was happening during it. Accumulating and flushing per frame keeps every
 * series the same length and index-aligned with `frame`.
 */
const PER_FRAME_METRICS = METRICS.filter((m) => m !== 'frame' && m !== 'js');

let enabled = false;

/**
 * Turn sampling on. Off by default so desktop builds pay nothing; the app
 * enables it for tablet builds, where the on-screen readout is the only
 * profiler available.
 */
export function setCanvasPerfEnabled(value: boolean): void {
  enabled = value;
}

export function isCanvasPerfEnabled(): boolean {
  return enabled;
}

/** Ring buffer per metric. Fixed size, so sampling never allocates. */
const samples = new Map<CanvasPerfMetric, Float32Array>(
  METRICS.map((m) => [m, new Float32Array(WINDOW)]),
);
const counts = new Map<CanvasPerfMetric, number>(METRICS.map((m) => [m, 0]));
const cursors = new Map<CanvasPerfMetric, number>(METRICS.map((m) => [m, 0]));

export function recordCanvasPerf(metric: CanvasPerfMetric, ms: number): void {
  if (!enabled) {
    return;
  }
  const buffer = samples.get(metric);
  const cursor = cursors.get(metric);
  if (!buffer || cursor === undefined) {
    return;
  }
  buffer[cursor] = ms;
  cursors.set(metric, (cursor + 1) % WINDOW);
  counts.set(metric, Math.min(WINDOW, (counts.get(metric) ?? 0) + 1));
}

/** Totals accumulated for the frame currently in flight. */
const pending = new Map<CanvasPerfMetric, number>();

/** Add to this frame's running total for a metric. @see PER_FRAME_METRICS */
export function addCanvasPerf(metric: CanvasPerfMetric, value: number): void {
  if (!enabled) {
    return;
  }
  pending.set(metric, (pending.get(metric) ?? 0) + value);
}

/** Time `fn`, add it to this frame's total, and return whatever it returned. */
export function measureCanvasPerf<T>(metric: CanvasPerfMetric, fn: () => T): T {
  if (!enabled) {
    return fn();
  }
  const start = performance.now();
  try {
    return fn();
  } finally {
    addCanvasPerf(metric, performance.now() - start);
  }
}

/**
 * Time `fn` as pointer-input handling.
 *
 * Pointer events do not arrive one per frame — a stylus reporting at 120Hz+
 * delivers several between frames — and the useful quantity is how much of a
 * frame's budget input ate, not the cost of one event.
 */
export function measureCanvasInput<T>(fn: () => T): T {
  return measureCanvasPerf('input', fn);
}

/**
 * Close out the frame: record every per-frame total and reset for the next one.
 * A metric nothing touched this frame records a zero, which is the point — a
 * skipped layer costs nothing and must read as nothing, not as a missing row.
 */
export function flushCanvasPerfFrame(): void {
  if (!enabled) {
    return;
  }
  for (const metric of PER_FRAME_METRICS) {
    recordCanvasPerf(metric, pending.get(metric) ?? 0);
  }
  pending.clear();
}

function mean(metric: CanvasPerfMetric): number {
  const buffer = samples.get(metric);
  const count = counts.get(metric) ?? 0;
  if (!buffer || count === 0) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += buffer[i];
  }
  return total / count;
}

function p95(metric: CanvasPerfMetric): number {
  const buffer = samples.get(metric);
  const count = counts.get(metric) ?? 0;
  if (!buffer || count === 0) {
    return 0;
  }
  const sorted = Array.from(buffer.subarray(0, count)).sort((a, b) => a - b);
  return sorted[Math.min(count - 1, Math.floor(count * 0.95))];
}

export interface CanvasPerfSummary {
  /** Mean gap between animation frames, ms. */
  frame: number;
  /** 95th-percentile frame gap, ms — where the stalls show up. */
  frameP95: number;
  /** Mean time inside our redraw, ms. */
  js: number;
  /** Mean time handling pointer input per frame, ms. */
  input: number;
  /** Mean time in the page-frame DOM layer's own sync loop, ms. */
  pageFrame: number;
  /** Frame gap left after our own work: the browser's share, ms. */
  browser: number;
  bg: number;
  fg: number;
  overlay: number;
  dom: number;
  /** Share of redraws (0-1) on which each layer actually repainted. */
  bgPaint: number;
  fgPaint: number;
  overlayPaint: number;
}

export function canvasPerfSummary(): CanvasPerfSummary {
  const frame = mean('frame');
  const js = mean('js');
  const input = mean('input');
  const pageFrame = mean('pageFrame');
  return {
    frame,
    frameP95: p95('frame'),
    js,
    input,
    pageFrame,
    browser: Math.max(0, frame - js - input - pageFrame),
    bg: mean('bg'),
    fg: mean('fg'),
    overlay: mean('overlay'),
    dom: mean('dom'),
    bgPaint: mean('bgPaint'),
    fgPaint: mean('fgPaint'),
    overlayPaint: mean('overlayPaint'),
  };
}

/** Compact one-line rendering for the canvas status bar. */
export function formatCanvasPerf(s: CanvasPerfSummary): string {
  const n = (v: number) => v.toFixed(1);
  const pct = (v: number) => Math.round(v * 100);
  return `f ${n(s.frame)}/${n(s.frameP95)} js ${n(s.js)} in ${n(s.input)} pf ${n(s.pageFrame)} br ${n(s.browser)} | bg ${n(s.bg)} fg ${n(s.fg)} ov ${n(s.overlay)} dom ${n(s.dom)} | paint ${pct(s.bgPaint)}/${pct(s.fgPaint)}/${pct(s.overlayPaint)}`;
}

/** Samples for one metric, oldest first. */
function orderedSamples(metric: CanvasPerfMetric): number[] {
  const buffer = samples.get(metric);
  const count = counts.get(metric) ?? 0;
  const cursor = cursors.get(metric) ?? 0;
  if (!buffer || count === 0) {
    return [];
  }
  // Below capacity the buffer was filled front to back; at capacity the oldest
  // sample is wherever the cursor is about to overwrite next.
  const ordered =
    count < WINDOW
      ? Array.from(buffer.subarray(0, count))
      : [
          ...Array.from(buffer.subarray(cursor)),
          ...Array.from(buffer.subarray(0, cursor)),
        ];
  return ordered.map((v) => Math.round(v * 100) / 100);
}

/** Device details worth having alongside a trace. Empty outside a browser. */
function browserEnvironment(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return {};
  }
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    // The capped scale canvases are actually sized at, so a trace shows whether
    // the tablet cap took effect rather than leaving it to be inferred.
    renderScale: renderScale(),
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

/**
 * The whole retained history plus the environment it was captured in, as JSON.
 *
 * This exists so a sideloaded device can hand over a real trace instead of a
 * number read off the screen. Every series is the same length and index-aligned
 * with `frame`, so a slow frame can be read across rows to see what ran during
 * it.
 */
export function exportCanvasPerfTrace(
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      ...browserEnvironment(),
      ...context,
      summary: canvasPerfSummary(),
      note: 'ms per frame. frame=wall-clock gap, js=our redraw, input=pointer handling, pageFrame=page-frame DOM sync loop, browser=whatever is left (layout/paint/composite/GC). Every series is index-aligned with frame; a zero means that work did not run. *Paint metrics are 0/1, not ms.',
      samples: Object.fromEntries(METRICS.map((m) => [m, orderedSamples(m)])),
    },
    null,
    2,
  );
}

export function resetCanvasPerf(): void {
  for (const metric of METRICS) {
    counts.set(metric, 0);
    cursors.set(metric, 0);
  }
}
