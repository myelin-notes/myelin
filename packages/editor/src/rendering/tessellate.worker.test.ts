import { expect, it, vi } from 'vitest';
import { tessellate } from './tessellate';

it('preserves tessellation geometry and local-coordinate precision in the worker', async () => {
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn(),
  };
  vi.stubGlobal('self', worker);
  try {
    await import('./tessellate.worker');
    const coords = new Float64Array([
      1e10,
      1e10,
      1e10 + 10,
      1e10 + 10,
      1e10,
      1e10 + 10,
      1e10 + 10,
      1e10,
    ]);
    worker.onmessage?.({
      data: { requestId: 7, contours: [coords] },
    } as MessageEvent);
    const [result, transfer] = worker.postMessage.mock.calls[0];
    const expected = tessellate([
      {
        closed: true,
        points: [
          { x: 1e10, y: 1e10 },
          { x: 1e10 + 10, y: 1e10 + 10 },
          { x: 1e10, y: 1e10 + 10 },
          { x: 1e10 + 10, y: 1e10 },
        ],
      },
    ]);
    expect(result.requestId).toBe(7);
    expect([...result.vertices]).toEqual(
      [...expected].map((value, index) => value - expected[index % 2]),
    );
    expect(transfer).toEqual([result.vertices.buffer]);
  } finally {
    vi.unstubAllGlobals();
  }
});
