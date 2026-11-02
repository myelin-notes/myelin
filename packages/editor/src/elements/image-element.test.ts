import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/messages/en';
import { setPlatform } from '../platform';
import { createFakePlatform } from '../test/fake-platform';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { ImageElement } from './image-element';

function loadImage(sourceUrl: string): ImageElement {
  const ydoc = new YDocManager();
  const yMap = ydoc.createElementMap(ElementType.IMAGE, 'img', {
    imageData: new Uint8Array([0]),
    naturalWidth: 4,
    naturalHeight: 4,
    cropX: 0,
    cropY: 0,
    cropW: 4,
    cropH: 4,
    sourceUrl,
  });
  const img = new ImageElement('img');
  img.bindToYMap(yMap);
  return img;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubBitmaps() {
  const bitmaps: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('createImageBitmap', async () => {
    const bitmap = { width: 4, height: 4, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });
  return bitmaps;
}

describe('ImageElement bitmap lifetime', () => {
  it('closes a replaced bitmap, and the current one on disposal', async () => {
    const bitmaps = stubBitmaps();
    const img = new ImageElement('img');

    await img.setImageData(new ArrayBuffer(1));
    await img.setImageData(new ArrayBuffer(1));

    expect(bitmaps[0].close).toHaveBeenCalledOnce();
    expect(bitmaps[1].close).not.toHaveBeenCalled();

    img.disposeCanvas();

    expect(bitmaps[1].close).toHaveBeenCalledOnce();
  });

  it('closes a bitmap that finishes decoding after disposal', async () => {
    let finishDecode!: (bitmap: unknown) => void;
    vi.stubGlobal(
      'createImageBitmap',
      () =>
        new Promise((resolve) => {
          finishDecode = resolve;
        }),
    );
    const img = loadImage('https://example.com/a.png');
    const decoded = img.prepareThumbnail();

    img.disposeCanvas();
    const bitmap = { width: 4, height: 4, close: vi.fn() };
    finishDecode(bitmap);
    await decoded;

    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('removes the crop key listener when disposed in toolbar crop mode', async () => {
    stubBitmaps();
    const removeEventListener = vi.fn();
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener,
    });
    const img = loadImage('https://example.com/a.png');
    await img.prepareThumbnail();

    img.toggleCropMode();
    img.disposeCanvas();

    expect(removeEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
  });
});

describe('ImageElement source link', () => {
  it('opens an http(s) source and drops other schemes from synced docs', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4, height: 4 }));
    const openExternal = vi.fn(async () => {});
    setPlatform(createFakePlatform({ openExternal }));
    const web = loadImage('https://example.com/a.png');
    const local = loadImage('file:///etc/passwd');
    await Promise.all([web.prepareThumbnail(), local.prepareThumbnail()]);

    web
      .getSelectionToolbarItems(en)
      .find((item) => item.id === 'source')
      ?.onClick();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a.png');
    expect(local.getSelectionToolbarItems(en).map((item) => item.id)).toEqual([
      'crop',
    ]);
  });
});
