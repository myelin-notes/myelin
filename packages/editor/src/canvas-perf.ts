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
 * redraw took inside that gap. Whatever separates them is the browser: layout,
 * paint, rasterization, compositing. A large `frame` with a small `js` means
 * the cost is not in code we can make faster by doing less of it.
 *
 * Caveat worth remembering when reading the numbers: canvas 2D calls are
 * recorded into a display list and rasterized later, so the cost of a heavy
 * `fillRect` shows up in the gap, not in `js`.
 */

/**
 * Frames retained per metric. At 20fps this is ~15 seconds of history, enough
 * that a trace copied straight after a pan covers the whole gesture.
 */
const WINDOW = 300;

export type CanvasPerfMetric = 'frame' | 'js' | 'bg' | 'fg' | 'overlay' | 'dom';

const METRICS: CanvasPerfMetric[] = [
  'frame',
  'js',
  'bg',
  'fg',
  'overlay',
  'dom',
];

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

/** Time `fn`, record it, and return whatever it returned. */
export function measureCanvasPerf<T>(metric: CanvasPerfMetric, fn: () => T): T {
  if (!enabled) {
    return fn();
  }
  const start = performance.now();
  try {
    return fn();
  } finally {
    recordCanvasPerf(metric, performance.now() - start);
  }
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
  /** Frame gap not accounted for by our redraw: the browser's share, ms. */
  browser: number;
  bg: number;
  fg: number;
  overlay: number;
  dom: number;
}

export function canvasPerfSummary(): CanvasPerfSummary {
  const frame = mean('frame');
  const js = mean('js');
  return {
    frame,
    frameP95: p95('frame'),
    js,
    browser: Math.max(0, frame - js),
    bg: mean('bg'),
    fg: mean('fg'),
    overlay: mean('overlay'),
    dom: mean('dom'),
  };
}

/** Compact one-line rendering for the canvas status bar. */
export function formatCanvasPerf(s: CanvasPerfSummary): string {
  const n = (v: number) => v.toFixed(1);
  return `f ${n(s.frame)}/${n(s.frameP95)} js ${n(s.js)} br ${n(s.browser)} | bg ${n(s.bg)} fg ${n(s.fg)} ov ${n(s.overlay)} dom ${n(s.dom)}`;
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
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

/**
 * The whole retained history plus the environment it was captured in, as JSON.
 *
 * This exists so a sideloaded device can hand over a real trace instead of a
 * number read off the screen. Phase metrics are only sampled on frames that
 * actually painted (the render loop skips clean frames), so they can be shorter
 * than `frame` and are not row-aligned with it.
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
      note: 'ms per frame. frame=wall-clock gap, js=our redraw, browser=frame-js (layout/paint/composite). Phases sampled only on painted frames.',
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
