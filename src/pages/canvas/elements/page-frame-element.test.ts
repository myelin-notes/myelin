import { describe, expect, it, vi } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { PAGE_HEIGHT, PAGE_WIDTH } from './page-frame-constants';
import { PageFrameElement } from './page-frame-element';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}));

describe('PageFrameElement display name', () => {
  it('serializes a deterministic default display name', () => {
    const frame = new PageFrameElement(2);

    expect(frame.displayName).toBe('Page Frame 3');
    expect(frame.getYMapProps()).toMatchObject({
      displayName: 'Page Frame 3',
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
  });

  it('hydrates and writes display name through the Yjs map', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 4, {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      displayName: 'Research Notes',
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
    const frame = new PageFrameElement(4);

    frame.bindToYMap(yMap);
    expect(frame.displayName).toBe('Research Notes');

    frame.setDisplayName('  Source excerpts  ');
    expect(frame.displayName).toBe('Source excerpts');
    expect(yMap.get('displayName')).toBe('Source excerpts');
  });

  it('falls back to the default display name for blank or missing values', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 1, {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
    const frame = new PageFrameElement(1);

    frame.bindToYMap(yMap);
    expect(frame.displayName).toBe('Page Frame 2');

    frame.setDisplayName('');
    expect(frame.displayName).toBe('Page Frame 2');
    expect(yMap.get('displayName')).toBeUndefined();

    yMap.set('displayName', '  ');
    frame.syncFromYMap(['displayName']);
    expect(frame.displayName).toBe('Page Frame 2');
  });
});
