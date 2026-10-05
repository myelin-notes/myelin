import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureVideoFrame, prepareCapturedPhoto } from './photo-capture';

function installCanvas() {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback: (blob: Blob) => void) => {
      callback(new Blob(['jpeg-data'], { type: 'image/jpeg' }));
    }),
  };
  vi.stubGlobal('document', {
    createElement: vi.fn(() => canvas),
  });
  return { canvas, drawImage };
}

describe('photo capture', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('inserts a desktop camera frame as a JPEG at its native resolution', async () => {
    const { canvas, drawImage } = installCanvas();
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;

    const photo = await captureVideoFrame(video);

    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0);
    expect(photo.type).toBe('image/jpeg');
    expect(await photo.text()).toBe('jpeg-data');
  });

  it('converts a mobile capture in an unsupported format and releases its URL', async () => {
    const { canvas, drawImage } = installCanvas();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:captured'),
      revokeObjectURL,
    });
    class CapturedImage {
      public src = '';
      public naturalWidth = 3024;
      public naturalHeight = 4032;
      public decode = vi.fn(async () => {});
    }
    vi.stubGlobal('Image', CapturedImage);
    const original = new File(['heic-data'], 'photo.heic', {
      type: 'image/heic',
    });

    const photo = await prepareCapturedPhoto(original);

    expect(canvas.width).toBe(3024);
    expect(canvas.height).toBe(4032);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(photo.type).toBe('image/jpeg');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:captured');
  });

  it('keeps camera JPEG files without converting them again', async () => {
    const original = new File(['jpeg-data'], 'photo.jpg', {
      type: 'image/jpeg',
    });

    expect(await prepareCapturedPhoto(original)).toBe(original);
  });
});
