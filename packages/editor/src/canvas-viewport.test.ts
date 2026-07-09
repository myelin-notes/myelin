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

  return { viewport, wheel };
}

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
