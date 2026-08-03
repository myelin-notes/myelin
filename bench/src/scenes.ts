import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { PageFrameElement } from '@myelin/editor/elements/page-frame-element';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import type { BenchConfig } from './config';

/**
 * Deterministic pseudo-random source.
 *
 * Scene geometry must be identical across runs or two configurations are not
 * comparable — a scene that happens to place more ink inside the viewport
 * would read as a slower renderer.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Page frames, left empty and out of edit mode.
 *
 * Empty is deliberate: the cost under investigation is what a page frame makes
 * the app do *per frame* — creating its DOM container, its editor view, and
 * re-writing its transform as the view moves — not laying out its text. If an
 * empty frame already accounts for the gap, content would only confound it.
 */
function buildPageFrames(canvas: DrawableCanvas, count: number): void {
  for (let i = 0; i < count; i++) {
    const frame = canvas.addElement(
      (uuid) => new PageFrameElement(uuid, `Bench page ${i + 1}`, 'vertical'),
    );
    frame.setOffset(i * 900 - (count - 1) * 450, 0);
    frame.updateBounds();
  }
}

/** One handwriting-scale squiggle: the shape the renderer actually fills. */
function squiggle(
  random: () => number,
  originX: number,
  originY: number,
  points: number,
): number[] {
  const flat: number[] = [];
  const amplitude = 8 + random() * 12;
  const step = 2 + random() * 2;
  const phase = random() * Math.PI * 2;
  for (let i = 0; i < points; i++) {
    flat.push(
      originX + i * step,
      originY + Math.sin(phase + i * 0.35) * amplitude,
      0.5,
    );
  }
  return flat;
}

/**
 * Populate the canvas for a configuration.
 *
 * Strokes are laid out in a grid around the origin so that the starting
 * viewport sees a representative share of them rather than all or none.
 */
export function buildScene(canvas: DrawableCanvas, config: BenchConfig): void {
  if (config.scene === 'pageframe') {
    buildPageFrames(canvas, config.pages);
    return;
  }
  // A page frame with ink on it — what is actually on screen when the app
  // feels slow, rather than either half of it in isolation.
  if (config.scene === 'note') {
    buildPageFrames(canvas, config.pages);
  }
  if (
    (config.scene !== 'strokes' && config.scene !== 'note') ||
    config.strokes <= 0
  ) {
    return;
  }

  const random = makeRandom(0x5eed);
  const columns = Math.max(1, Math.ceil(Math.sqrt(config.strokes)));
  const spacingX = 240;
  const spacingY = 120;

  for (let i = 0; i < config.strokes; i++) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const flat = squiggle(
      random,
      (column - columns / 2) * spacingX,
      (row - columns / 2) * spacingY,
      config.points,
    );
    const element = canvas.addElement(
      (uuid) =>
        new StrokeElement(uuid, flat, true, { color: '#1f2937', size: 6 }),
    );
    element.updateBounds();
  }
}
