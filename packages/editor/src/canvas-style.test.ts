import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  clearCanvasStyle,
  getCanvasStyle,
  hasCanvasStyleOverride,
  setCanvasStyle,
} from './canvas-style';

describe('canvas style', () => {
  it('follows the global default until the canvas gets its own style', () => {
    const doc = new Y.Doc();
    setCanvasStyle(null, { pattern: 'grid' });
    expect(getCanvasStyle(doc).pattern).toBe('grid');

    setCanvasStyle(doc, {
      patternColorMode: 'custom',
      patternColor: '#ff0000',
    });
    setCanvasStyle(null, { pattern: 'dots' });

    expect(hasCanvasStyleOverride(doc)).toBe(true);
    expect(getCanvasStyle(doc)).toMatchObject({
      pattern: 'grid',
      patternColor: '#ff0000',
    });
    expect(getCanvasStyle(new Y.Doc()).pattern).toBe('dots');

    clearCanvasStyle(doc);
    expect(getCanvasStyle(doc).pattern).toBe('dots');
  });

  it('drops a peer image that is not an inline PNG of tile size', () => {
    const doc = new Y.Doc();
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    setCanvasStyle(doc, {
      pattern: 'image',
      image: { src: png, width: 32, height: 32 },
    });
    expect(getCanvasStyle(doc).image?.src).toBe(png);

    setCanvasStyle(doc, {
      image: { src: 'https://example.com/x.png', width: 32, height: 32 },
    });
    expect(getCanvasStyle(doc).image).toBeNull();

    setCanvasStyle(doc, { image: { src: png, width: 1e6, height: 32 } });
    expect(getCanvasStyle(doc).image).toBeNull();
  });
});
