const MAX_POOLED_CANVASES = 8;

const htmlCanvasPool: HTMLCanvasElement[] = [];

export interface ScratchCanvasBlobOptions {
  type?: string;
  quality?: number;
}

export interface ScratchCanvasContext {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  toBlob(options?: ScratchCanvasBlobOptions): Promise<Blob>;
  toBytes(options?: ScratchCanvasBlobOptions): Promise<Uint8Array>;
  release(): void;
}

export function getScratchCanvasContext(
  width: number,
  height: number,
): ScratchCanvasContext {
  const canvasWidth = Math.max(1, Math.ceil(width));
  const canvasHeight = Math.max(1, Math.ceil(height));

  if (canUseOffscreenCanvas()) {
    return createOffscreenCanvasContext(canvasWidth, canvasHeight);
  }

  return createHtmlCanvasContext(canvasWidth, canvasHeight);
}

function canUseOffscreenCanvas(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.convertToBlob === 'function'
  );
}

function createOffscreenCanvasContext(
  width: number,
  height: number,
): ScratchCanvasContext {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    throw new Error('Could not create offscreen canvas context');
  }

  let released = false;
  const assertActive = () => {
    if (released) {
      throw new Error('Scratch canvas has already been released');
    }
  };

  return {
    canvas,
    context: context as unknown as CanvasRenderingContext2D,
    width,
    height,
    async toBlob(options = {}) {
      assertActive();
      return canvas.convertToBlob({
        type: options.type ?? 'image/png',
        quality: options.quality,
      });
    },
    async toBytes(options = {}) {
      const blob = await this.toBlob(options);
      return new Uint8Array(await blob.arrayBuffer());
    },
    release() {
      if (released) {
        return;
      }
      released = true;
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

function createHtmlCanvasContext(
  width: number,
  height: number,
): ScratchCanvasContext {
  const canvas = htmlCanvasPool.pop() ?? document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { alpha: true });
  if (!context) {
    throw new Error('Could not create canvas context');
  }

  let released = false;
  const assertActive = () => {
    if (released) {
      throw new Error('Scratch canvas has already been released');
    }
  };

  return {
    canvas,
    context,
    width,
    height,
    async toBlob(options = {}) {
      assertActive();
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Could not encode canvas'));
            }
          },
          options.type ?? 'image/png',
          options.quality,
        );
      });
    },
    async toBytes(options = {}) {
      const blob = await this.toBlob(options);
      return new Uint8Array(await blob.arrayBuffer());
    },
    release() {
      if (released) {
        return;
      }
      released = true;
      canvas.width = 1;
      canvas.height = 1;
      if (htmlCanvasPool.length < MAX_POOLED_CANVASES) {
        htmlCanvasPool.push(canvas);
      }
    },
  };
}
