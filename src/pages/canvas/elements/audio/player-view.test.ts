import { describe, expect, it, vi } from 'vitest';
import { getWaveformCanvasMetrics } from './player-view';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

describe('getWaveformCanvasMetrics', () => {
  it('uses the device pixel ratio for ordinary waveform sizes', () => {
    expect(getWaveformCanvasMetrics(188, 28, 2)).toEqual({
      cssWidth: 188,
      cssHeight: 28,
      pixelRatio: 2,
      backingWidth: 376,
      backingHeight: 56,
    });
  });

  it('caps the backing store for very large zoomed waveforms', () => {
    const metrics = getWaveformCanvasMetrics(3000, 2000, 2);

    expect(metrics.backingWidth).toBe(4096);
    expect(metrics.backingHeight).toBeLessThanOrEqual(4096);
  });

  it('normalizes invalid display sizes and device pixel ratios', () => {
    expect(getWaveformCanvasMetrics(0, -4, 0)).toEqual({
      cssWidth: 1,
      cssHeight: 1,
      pixelRatio: 1,
      backingWidth: 1,
      backingHeight: 1,
    });
  });
});
