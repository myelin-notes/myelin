import { describe, expect, it } from 'vitest';
import { positionTourCard } from './position';
import { resolveTourSteps, TOUR_STEPS } from './steps';

const VIEWPORT = { width: 1280, height: 800 };
const CARD = { width: 320, height: 200 };

describe('resolveTourSteps', () => {
  it('keeps every stop when the whole desktop shell is mounted', () => {
    expect(resolveTourSteps(() => true)).toEqual(TOUR_STEPS);
  });

  it('drops the sidebar stops when there is no sidebar, keeping order', () => {
    const steps = resolveTourSteps((anchor) => anchor.startsWith('canvas-'));
    expect(steps.map((step) => step.id)).toEqual(['tools', 'insert']);
  });

  it('resolves to nothing when no anchor is on screen', () => {
    expect(resolveTourSteps(() => false)).toEqual([]);
  });
});

describe('positionTourCard', () => {
  it('places the card to the right of its anchor', () => {
    const anchor = { left: 40, top: 200, width: 60, height: 300 };
    expect(positionTourCard(anchor, 'right', CARD, VIEWPORT)).toEqual({
      left: 116,
      top: 200,
    });
  });

  it('flips to the left when the right side would overflow', () => {
    const anchor = { left: 1100, top: 100, width: 60, height: 60 };
    expect(positionTourCard(anchor, 'right', CARD, VIEWPORT).left).toBe(764);
  });

  it('flips above the anchor when the space below is too short', () => {
    const anchor = { left: 100, top: 700, width: 60, height: 60 };
    expect(positionTourCard(anchor, 'bottom', CARD, VIEWPORT).top).toBe(484);
  });

  it('keeps the card on screen when the anchor hugs an edge', () => {
    const anchor = { left: 0, top: 780, width: 40, height: 20 };
    const { left, top } = positionTourCard(anchor, 'right', CARD, VIEWPORT);
    expect(left).toBeGreaterThanOrEqual(16);
    expect(top).toBeLessThanOrEqual(VIEWPORT.height - CARD.height - 16);
  });
});
