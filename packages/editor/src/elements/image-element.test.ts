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
