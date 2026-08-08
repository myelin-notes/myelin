import type { PlainFrameMode } from './plain-frame';

/** Which canvas layers the scenario mounts. @see index.html */
export type LayerSet = 'fg' | 'fg+bg' | 'all';

/** What drives change between frames. */
export type InputMode = 'idle' | 'pan' | 'zoom' | 'draw';

export type SceneName = 'empty' | 'strokes' | 'pageframe' | 'note';

/**
 * Background style, mirroring the `canvasBackground` user pref.
 *
 * `blank` is the control: the layer still exists, is still sized to the
 * viewport, and is still cleared every frame — it just paints nothing. The gap
 * between `blank` and `dots` is the cost of the pattern fill alone.
 */
export type BackgroundStyle = 'grid' | 'dots' | 'blank';

/**
 * How the background layer decides what to paint.
 *
 * `stepped` is what ships: the tiling is painted at half-octave zoom steps and
 * the remainder rides on the transform. `exact` restores the behaviour it
 * replaced, so a device that cannot report raster counts can still price the
 * difference by running both.
 */
export type BackgroundRaster = 'stepped' | 'exact';

/** @see FrameShadow usage in `page-frame-ablations.ts` for the actual values. */
export type FrameShadow = 'on' | 'small' | 'off';

export type { PlainFrameMode } from './plain-frame';

export interface BenchConfig {
  scene: SceneName;
  /** Element count for the `strokes` scene. */
  strokes: number;
  /** Recorded points per stroke. */
  points: number;
  layers: LayerSet;
  background: BackgroundStyle;
  input: InputMode;
  bgRaster: BackgroundRaster;
  /**
   * Mount the app's React page-frame DOM layer.
   *
   * Off by default so the canvas renderer can be measured on its own; the real
   * app always has it, so it is on for any case meant to represent the app.
   */
  domLayer: boolean;
  /** Page frames created by the `pageframe` scene. */
  pages: number;
  /**
   * Composite each page frame's scaled inner viewport on its own layer.
   *
   * Not what ships — an experiment the device has to settle, because it trades
   * repaint cost against how crisp text stays after a zoom.
   */
  promoteFrame: boolean;
  /**
   * The page sheet's drop shadow. `off` prices the blur; `small` prices it
   * against a narrower one, which is what says whether the cost follows the
   * blur radius or merely the presence of a shadow.
   */
  frameShadow: FrameShadow;
  /**
   * Replace the page frame with a bare white rectangle of the same size,
   * followed the same way. The control for "should an element this size cost
   * this much at all", and — as the `stepped`/`held` pair — for "does rescaling
   * a promoted layer repaint it". @see plain-frame.ts
   */
  plainFrame: PlainFrameMode | null;
  /**
   * Keep `will-change: transform` on the frame chrome's root. Off asks whether
   * a compositing layer that is resized every zoom frame is costing more than
   * it saves.
   */
  chromePromoted: boolean;
  /**
   * Keep the ProseMirror editor visible inside each page frame. Off asks
   * whether the live contenteditable is what a blank-looking page costs.
   */
  frameEditor: boolean;
  /**
   * Keep the residual zoom on the chrome root's transform between raster steps.
   * Off asks whether rescaling that layer is what repaints its subtree every
   * zoom frame. @see pinChromeRasterScale
   */
  chromeRescaled: boolean;
  /**
   * Backing-store pixels per CSS pixel. Overrides `window.devicePixelRatio`
   * rather than going through CDP's `deviceScaleFactor`, which would also
   * rescale CSS layout. The variable under test is how many pixels each layer
   * rasterizes and uploads per frame, and this changes only that.
   */
  dpr: number;
  /** Discarded before measurement: JIT warmup, first-paint, pattern build. */
  warmupMs: number;
  durationMs: number;
  /** Report and exit rather than looping forever (the driver reads the result). */
  auto: boolean;
}

const DEFAULTS: BenchConfig = {
  scene: 'empty',
  strokes: 0,
  points: 64,
  layers: 'all',
  background: 'dots',
  input: 'pan',
  bgRaster: 'stepped',
  domLayer: false,
  pages: 1,
  promoteFrame: false,
  frameShadow: 'on',
  plainFrame: null,
  chromePromoted: true,
  frameEditor: true,
  chromeRescaled: true,
  dpr: window.devicePixelRatio || 1,
  warmupMs: 600,
  durationMs: 4000,
  auto: false,
};

function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function oneOf<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = params.get(key);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

export function readConfig(search: string): BenchConfig {
  const params = new URLSearchParams(search);
  const scene = oneOf(
    params,
    'scene',
    ['empty', 'strokes', 'pageframe', 'note'] as const,
    'empty',
  );
  return {
    scene,
    // A `strokes` scene with no count asked for is a mistake that would
    // silently measure an empty canvas, so give it a default population.
    strokes: num(
      params,
      'strokes',
      scene === 'strokes' || scene === 'note' ? 50 : 0,
    ),
    points: num(params, 'points', DEFAULTS.points),
    layers: oneOf(params, 'layers', ['fg', 'fg+bg', 'all'] as const, 'all'),
    background: oneOf(
      params,
      'bg',
      ['grid', 'dots', 'blank'] as const,
      DEFAULTS.background,
    ),
    input: oneOf(
      params,
      'input',
      ['idle', 'pan', 'zoom', 'draw'] as const,
      'pan',
    ),
    bgRaster: oneOf(
      params,
      'bgRaster',
      ['stepped', 'exact'] as const,
      DEFAULTS.bgRaster,
    ),
    domLayer: params.get('domLayer') === '1',
    pages: num(params, 'pages', DEFAULTS.pages),
    promoteFrame: params.get('promoteFrame') === '1',
    frameShadow: oneOf(
      params,
      'frameShadow',
      ['on', 'small', 'off'] as const,
      DEFAULTS.frameShadow,
    ),
    plainFrame:
      (['scale', 'resize', 'promoted', 'stepped', 'held'] as const).find(
        (mode) => mode === params.get('plainFrame'),
      ) ?? null,
    chromePromoted: params.get('chromePromoted') !== '0',
    frameEditor: params.get('frameEditor') !== '0',
    chromeRescaled: params.get('chromeRescaled') !== '0',
    dpr: num(params, 'dpr', DEFAULTS.dpr),
    warmupMs: num(params, 'warmup', DEFAULTS.warmupMs),
    durationMs: num(params, 'duration', DEFAULTS.durationMs),
    auto: params.get('auto') === '1',
  };
}

/**
 * Install the configured backing-store scale.
 *
 * Must run before any canvas is sized. `devicePixelRatio` is an accessor on
 * `window`, so it can be redefined; the renderer reads it on every resize and
 * every frame, so nothing caches the real value behind our back.
 */
export function applyDprOverride(dpr: number): void {
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    get: () => dpr,
  });
}
