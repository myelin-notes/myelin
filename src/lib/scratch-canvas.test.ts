import { afterEach, describe, expect, it, vi } from 'vitest';

function makeContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function makeHtmlCanvas(blobBytes: number[]): HTMLCanvasElement {
  const context = makeContext();
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback, type?: string) => {
      callback(new Blob([new Uint8Array(blobBytes)], { type }));
    }),
  } as unknown as HTMLCanvasElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getScratchCanvasContext', () => {
  it('uses OffscreenCanvas when it supports blob export', async () => {
    const context = makeContext();
    const createElement = vi.fn();

    class TestOffscreenCanvas {
      public width: number;
      public height: number;

      public constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      public getContext = vi.fn(() => context);

      public async convertToBlob(options?: ImageEncodeOptions): Promise<Blob> {
        return new Blob([new Uint8Array([7, 8])], { type: options?.type });
      }
    }

    vi.stubGlobal('document', { createElement });
    vi.stubGlobal('OffscreenCanvas', TestOffscreenCanvas);

    const { getScratchCanvasContext } = await import('./scratch-canvas');
    const scratch = getScratchCanvasContext(10.2, 20.1);

    expect(scratch.canvas).toBeInstanceOf(TestOffscreenCanvas);
    expect(scratch.width).toBe(11);
    expect(scratch.height).toBe(21);
    expect(createElement).not.toHaveBeenCalled();
    await expect(scratch.toBytes()).resolves.toEqual(new Uint8Array([7, 8]));

    scratch.release();
    expect(scratch.canvas.width).toBe(1);
    expect(scratch.canvas.height).toBe(1);
  });

  it('pools HTML canvases when OffscreenCanvas is unavailable', async () => {
    const canvas = makeHtmlCanvas([1, 2, 3]);
    const createElement = vi.fn((tagName: string) => {
      expect(tagName).toBe('canvas');
      return canvas;
    });

    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', { createElement });

    const { getScratchCanvasContext } = await import('./scratch-canvas');
    const first = getScratchCanvasContext(10, 20);
    await expect(first.toBytes()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    first.release();

    const second = getScratchCanvasContext(30, 40);

    expect(second.canvas).toBe(canvas);
    expect(second.width).toBe(30);
    expect(second.height).toBe(40);
    expect(createElement).toHaveBeenCalledTimes(1);
    second.release();
  });
});
