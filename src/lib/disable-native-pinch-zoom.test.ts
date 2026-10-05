import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@myelin/shared/os', () => ({ isWindows: true }));

import { disableNativePinchZoom } from './disable-native-pinch-zoom';

type Listener = EventListenerOrEventListenerObject;

describe('disableNativePinchZoom', () => {
  const listeners = new Map<string, Listener>();
  const addEventListener = vi.fn((type: string, listener: Listener): void => {
    listeners.set(type, listener);
  });

  beforeEach(() => {
    listeners.clear();
    addEventListener.mockClear();
    vi.stubGlobal('document', { addEventListener });
    disableNativePinchZoom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prevents native Ctrl-wheel zoom at capture phase', () => {
    const event = {
      ctrlKey: true,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    const listener = listeners.get('wheel');
    if (typeof listener !== 'function') {
      throw new Error('Missing wheel listener');
    }
    listener(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith('wheel', listener, {
      capture: true,
      passive: false,
    });
  });

  it('allows ordinary wheel events to scroll', () => {
    const event = {
      ctrlKey: false,
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    const listener = listeners.get('wheel');
    if (typeof listener !== 'function') {
      throw new Error('Missing wheel listener');
    }
    listener(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('prevents native Ctrl keyboard zoom', () => {
    const event = {
      ctrlKey: true,
      key: '+',
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    const listener = listeners.get('keydown');
    if (typeof listener !== 'function') {
      throw new Error('Missing keydown listener');
    }
    listener(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
