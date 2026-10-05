import { describe, expect, it, vi } from 'vitest';
import { getFrameChromeControlsLayer } from './chrome';
import { CANVAS_ROOT_SELECTOR, CONTROLS_LAYER_SELECTOR } from './chrome-layout';

describe('getFrameChromeControlsLayer', () => {
  it('resolves the controls layer within the host canvas', () => {
    const leftControls = {} as HTMLElement;
    const rightControls = {} as HTMLElement;
    const leftRoot = {
      querySelector: vi.fn(() => leftControls),
    } as unknown as HTMLElement;
    const rightRoot = {
      querySelector: vi.fn(() => rightControls),
    } as unknown as HTMLElement;
    const leftHost = {
      closest: vi.fn(() => leftRoot),
    } as unknown as HTMLElement;
    const rightHost = {
      closest: vi.fn(() => rightRoot),
    } as unknown as HTMLElement;

    expect(getFrameChromeControlsLayer(leftHost)).toBe(leftControls);
    expect(getFrameChromeControlsLayer(rightHost)).toBe(rightControls);
    expect(leftHost.closest).toHaveBeenCalledWith(CANVAS_ROOT_SELECTOR);
    expect(rightRoot.querySelector).toHaveBeenCalledWith(
      CONTROLS_LAYER_SELECTOR,
    );
  });
});
