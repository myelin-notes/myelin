import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import type { InputMode } from './config';

/** Advances the scenario one frame. Called before each redraw. */
export type InputStep = (frame: number) => void;

/** World units panned per frame, at the peak of the sweep. */
const PAN_SPEED = 6;

/** Frames per full back-and-forth sweep. */
const PAN_PERIOD = 90;

/**
 * Pan oscillates rather than drifting in one direction.
 *
 * A constant-direction pan walks the content off screen within a second, so
 * the back half of a run would be measuring an empty viewport with the scene
 * behind it — the exact confound the scene exists to avoid.
 */
function panStep(canvas: DrawableCanvas): InputStep {
  return (frame) => {
    const dx = Math.cos((frame / PAN_PERIOD) * Math.PI * 2) * PAN_SPEED;
    const dy = Math.sin((frame / PAN_PERIOD) * Math.PI * 2) * PAN_SPEED * 0.6;
    canvas.viewport.panBy(dx, dy);
  };
}

/**
 * Zoom oscillates between 0.6x and 1.6x.
 *
 * Zoom is worth separating from pan because it defeats every trick that
 * depends on the view's scale holding still — the background pan-shift, and
 * any tile or bitmap cache a future renderer keeps per zoom level.
 */
function zoomStep(canvas: DrawableCanvas): InputStep {
  return (frame) => {
    const previous = Math.sin(((frame - 1) / PAN_PERIOD) * Math.PI * 2);
    const current = Math.sin((frame / PAN_PERIOD) * Math.PI * 2);
    canvas.viewport.zoomByFactor(
      (1 + current * 0.5) / (1 + previous * 0.5) || 1,
    );
  };
}

/**
 * Extend one stroke by a few points per frame, the way a stylus does.
 *
 * This drives the element directly instead of synthesizing pointer events, so
 * it isolates the cost of rebuilding a growing stroke from the cost of the
 * tool state machine and hit-testing around it. Those are worth measuring too,
 * but not in the same number.
 */
function drawStep(canvas: DrawableCanvas): InputStep {
  const stroke = canvas.addElement(
    (uuid) => new StrokeElement(uuid, [], true, { color: '#1f2937', size: 6 }),
  );
  // A 120Hz stylus delivers ~2 samples per frame at 60fps.
  const samplesPerFrame = 2;
  return (frame) => {
    for (let i = 0; i < samplesPerFrame; i++) {
      const t = frame * samplesPerFrame + i;
      stroke.addPoint(t * 1.5, Math.sin(t * 0.12) * 90, 0.5);
    }
  };
}

export function makeInputStep(
  canvas: DrawableCanvas,
  mode: InputMode,
): InputStep {
  switch (mode) {
    case 'idle':
      return () => {};
    case 'pan':
      return panStep(canvas);
    case 'zoom':
      return zoomStep(canvas);
    case 'draw':
      return drawStep(canvas);
  }
}
