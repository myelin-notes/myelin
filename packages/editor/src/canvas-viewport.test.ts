import { describe, expect, it, vi } from 'vitest';
import { CanvasViewport } from './canvas-viewport';

function createViewport() {
  const listeners = new Map<string, EventListener>();
  const target = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement;
  const canvas = {
    parentElement: target,
    width: 800,
    height: 600,
  } as HTMLCanvasElement;
  const viewport = new CanvasViewport(canvas);

  const wheel = (deltaX: number, deltaY: number) => {
    const event = {
      ctrlKey: false,
      deltaX,
      deltaY,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;
    listeners.get('wheel')?.(event);
    return event;
  };

  const touchStart = (touches: object[] = [{}]) => {
    const event = {
      touches,
      preventDefault: vi.fn(),
    } as unknown as TouchEvent;
    listeners.get('touchstart')?.(event);
    return event;
  };

  const touchMove = (touches: object[]) => {
    const event = {
      touches,
      preventDefault: vi.fn(),
    } as unknown as TouchEvent;
    listeners.get('touchmove')?.(event);
    return event;
  };

  return { viewport, wheel, touchStart, touchMove };
}

describe('CanvasViewport palm suppression', () => {
  it('does not pan or pinch while touch is suppressed', () => {
    const { viewport, touchStart, touchMove } = createViewport();
    viewport.setTouchSuppressedProvider(() => true);
    const touches = [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ];

    touchStart(touches);
    touchMove([touches[0], { clientX: 250, clientY: 250 }]);

    expect(viewport.offset).toEqual({ x: 0, y: 0 });
    expect(viewport.zoom).toBe(1);
  });
});

describe('CanvasViewport edit-mode wheel panning', () => {
  it('does not depend on DrawableCanvas exports', async () => {
    const moduleText = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./canvas-viewport.ts', import.meta.url), 'utf8'),
    );

    expect(moduleText).not.toContain("from './drawable-canvas'");
  });

  it('pans both axes outside edit mode', () => {
    const { viewport, wheel } = createViewport();

    const event = wheel(120, 50);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(viewport.offset).toEqual({ x: -120, y: -50 });
  });

  it('keeps edit-mode wheel panning vertical by default', () => {
    const { viewport, wheel } = createViewport();
    viewport.setEditMode(true);

    wheel(120, 50);

    expect(viewport.offset).toEqual({ x: 0, y: -50 });
  });

  it('keeps horizontal edit-mode wheel panning horizontal only', () => {
    const { viewport, wheel } = createViewport();
    viewport.setEditMode(true, { panAxis: 'horizontal' });

    wheel(120, 50);

    expect(viewport.offset).toEqual({ x: -120, y: 0 });
  });
});

describe('CanvasViewport content fitting', () => {
  it('fits the current content bounds', () => {
    const { viewport } = createViewport();
    const bounds = new DOMRect(100, 200, 1200, 900);
    viewport.setContentBoundsProvider(() => bounds);
    const animateViewToFitRect = vi
      .spyOn(viewport, 'animateViewToFitRect')
      .mockImplementation(() => {});

    viewport.animateFitContent();

    expect(animateViewToFitRect).toHaveBeenCalledWith(bounds, {
      widthRatio: 0.8,
      heightRatio: 0.8,
    });
  });

  it('does nothing when the canvas is empty', () => {
    const { viewport } = createViewport();
    viewport.setContentBoundsProvider(() => null);
    const animateViewToFitRect = vi
      .spyOn(viewport, 'animateViewToFitRect')
      .mockImplementation(() => {});

    viewport.animateFitContent();

    expect(animateViewToFitRect).not.toHaveBeenCalled();
  });
});

describe('CanvasViewport offset animation', () => {
  it('moves to the requested offset without changing zoom', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const { viewport } = createViewport();
    viewport.setView({ zoom: 2, offset: { x: 0, y: 0 } });

    viewport.animateOffsetTo({ x: 100, y: -50 });
    frames.shift()?.(250);

    expect(viewport.zoom).toBe(2);
    expect(viewport.offset.x).toBeCloseTo(96.875);
    expect(viewport.offset.y).toBeCloseTo(-48.4375);

    frames.shift()?.(400);
    expect(viewport.offset).toEqual({ x: 100, y: -50 });

    now.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('CanvasViewport pan inertia', () => {
  it('uses the native wheel stream without adding synthetic momentum', () => {
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    const { viewport } = createViewport();

    viewport.handleWheel({
      ctrlKey: false,
      deltaMode: 0,
      deltaX: 0,
      deltaY: 16,
      timeStamp: 0,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent);

    expect(viewport.offset).toEqual({ x: 0, y: -16 });
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('continues a quick touch pan after release', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { viewport } = createViewport();

    viewport.beginPanGesture(0);
    viewport.panGestureBy(16, -8, 16);
    viewport.endPanGesture(16);
    const releasedAt = { ...viewport.offset };
    frames.shift()?.(32);

    expect(viewport.offset.x).toBeGreaterThan(releasedAt.x);
    expect(viewport.offset.y).toBeLessThan(releasedAt.y);
    expect(viewport.isAnimatingView).toBe(true);

    viewport.destroy();
    vi.unstubAllGlobals();
  });

  it('stops precisely after a slow touch pan', () => {
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    const { viewport } = createViewport();

    viewport.beginPanGesture(0);
    viewport.panGestureBy(1, 0, 16);
    viewport.endPanGesture(16);

    expect(viewport.offset).toEqual({ x: 1, y: 0 });
    expect(viewport.isAnimatingView).toBe(false);
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('cancels momentum when a new gesture begins', () => {
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const { viewport } = createViewport();

    viewport.beginPanGesture(0);
    viewport.panGestureBy(16, 0, 16);
    viewport.endPanGesture(16);
    viewport.beginPanGesture(20);

    expect(viewport.isAnimatingView).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('cancels momentum as soon as a finger touches the canvas', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const { viewport, touchStart } = createViewport();

    viewport.beginPanGesture(0);
    viewport.panGestureBy(16, 0, 16);
    viewport.endPanGesture(16);
    touchStart();

    expect(viewport.isAnimatingView).toBe(false);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);

    vi.unstubAllGlobals();
  });
});

describe('CanvasViewport zoom limits', () => {
  it('restores a saved view', () => {
    const { viewport } = createViewport();

    viewport.setView({ zoom: 2, offset: { x: 120, y: -80 } });

    expect(viewport.zoom).toBe(2);
    expect(viewport.offset).toEqual({ x: 120, y: -80 });
  });

  it('clamps zoom between 5% and 500%', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const { viewport } = createViewport();

    viewport.zoomByFactor(1000);
    expect(viewport.zoom).toBe(5);

    viewport.zoomByFactor(0.00001);
    expect(viewport.zoom).toBe(0.05);

    vi.unstubAllGlobals();
  });
});
