import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PalmRejection } from './palm-rejection';

const PEN = 1;
const PALM = 2;
const FINGER = 3;

describe('PalmRejection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets touch through when no stylus has ever touched down', () => {
    const palm = new PalmRejection();
    expect(palm.suppressed).toBe(false);
    expect(palm.isPalm(FINGER)).toBe(false);
  });

  it('rejects a touch that lands while the stylus is down', () => {
    const palm = new PalmRejection();
    palm.penDown(PEN, []);
    expect(palm.suppressed).toBe(true);
    expect(palm.isPalm(PALM)).toBe(true);
  });

  it('reclassifies touches already on the screen when the stylus lands', () => {
    const palm = new PalmRejection();
    // The hand settles first and starts a pan; the tip follows a moment later.
    expect(palm.isPalm(PALM)).toBe(false);
    palm.penDown(PEN, [PALM]);
    expect(palm.isKnownPalm(PALM)).toBe(true);
  });

  it('keeps rejecting a resting palm after the grace window expires', () => {
    const palm = new PalmRejection();
    palm.penDown(PEN, []);
    palm.isPalm(PALM);
    palm.pointerUp(PEN);

    vi.advanceTimersByTime(5000);
    expect(palm.suppressed).toBe(false);
    // The hand never left, so it must not wake up as a fresh gesture.
    expect(palm.isPalm(PALM)).toBe(true);
  });

  it('holds touch off through the grace window, then releases it', () => {
    const palm = new PalmRejection();
    palm.penDown(PEN, []);
    palm.pointerUp(PEN);

    vi.advanceTimersByTime(400);
    expect(palm.suppressed).toBe(true);
    expect(palm.isPalm(FINGER)).toBe(true);

    vi.advanceTimersByTime(200);
    expect(palm.suppressed).toBe(false);
    expect(palm.isPalm(FINGER + 1)).toBe(false);
  });

  it('reports whether a lifted pointer was a rejected palm', () => {
    const palm = new PalmRejection();
    palm.penDown(PEN, []);
    palm.isPalm(PALM);

    expect(palm.pointerUp(PALM)).toBe(true);
    // Forgotten on lift, so the id is free to be reused by a real touch.
    expect(palm.isKnownPalm(PALM)).toBe(false);
    expect(palm.pointerUp(PEN)).toBe(false);
  });

  it('stays out of the way of a second stylus contact', () => {
    const palm = new PalmRejection();
    palm.penDown(PEN, []);
    palm.pointerUp(PEN);
    palm.penDown(PEN, []);
    expect(palm.suppressed).toBe(true);
  });
});
