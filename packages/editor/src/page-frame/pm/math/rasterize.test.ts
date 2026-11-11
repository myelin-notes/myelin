import { afterEach, expect, it, vi } from 'vitest';
import { rasterizeKatex } from './rasterize';

const { cleanup } = vi.hoisted(() => ({ cleanup: vi.fn() }));

vi.mock('html-to-image', () => ({
  toCanvas: () => new Promise(() => {}),
}));
vi.mock('./latex-probe', () => ({
  mountLatexProbe: () => ({ node: {}, cleanup }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('unmounts the probe and reports failure when the capture never settles', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });

  const result = rasterizeKatex('x^2', 2);
  await vi.advanceTimersByTimeAsync(5_000);

  await expect(result).resolves.toBeNull();
  expect(cleanup).toHaveBeenCalledOnce();
});
