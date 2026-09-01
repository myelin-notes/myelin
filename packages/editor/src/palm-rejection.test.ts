import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PalmRejection } from './palm-rejection';

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
  });

  it('rejects touch while the stylus is down', () => {
    const palm = new PalmRejection();
    palm.penDown();
    expect(palm.penContact).toBe(true);
    expect(palm.suppressed).toBe(true);
  });

  it('holds touch off through the grace window, then releases it', () => {
    const palm = new PalmRejection();
    palm.penDown();
    palm.penUp();
    expect(palm.penContact).toBe(false);

    vi.advanceTimersByTime(100);
    expect(palm.suppressed).toBe(true);

    vi.advanceTimersByTime(100);
    expect(palm.suppressed).toBe(false);
  });

  it('ignores a lift with no contact open', () => {
    const palm = new PalmRejection();
    palm.penUp();
    expect(palm.suppressed).toBe(false);
  });

  it('stays out of the way of a second stylus contact', () => {
    const palm = new PalmRejection();
    palm.penDown();
    palm.penUp();
    palm.penDown();
    expect(palm.suppressed).toBe(true);
  });
});
