import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import {
  DEFAULT_PAGE_FRAME_DISPLAY_NAME,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from './page-frame-constants';
import { PageFrameElement } from './page-frame-element';

describe('PageFrameElement display name', () => {
  it('serializes the default display name when none is provided', () => {
    const frame = new PageFrameElement('frame-uuid-1');

    expect(frame.displayName).toBe(DEFAULT_PAGE_FRAME_DISPLAY_NAME);
    expect(frame.getYMapProps()).toMatchObject({
      displayName: DEFAULT_PAGE_FRAME_DISPLAY_NAME,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pageLayout: 'vertical',
    });
  });

  it('uses the constructor page layout for new frames', () => {
    const frame = new PageFrameElement('frame-uuid-5', undefined, 'continuous');

    expect(frame.pageLayout).toBe('continuous');
    expect(frame.getYMapProps()).toMatchObject({
      pageLayout: 'continuous',
    });
  });

  it('hydrates and writes display name and page layout through the Yjs map', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-uuid-2', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      displayName: 'Research Notes',
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pageLayout: 'continuous',
    });
    const frame = new PageFrameElement('frame-uuid-2');

    frame.bindToYMap(yMap);
    expect(frame.displayName).toBe('Research Notes');
    expect(frame.pageLayout).toBe('continuous');

    frame.setDisplayName('  Source excerpts  ');
    expect(frame.displayName).toBe('Source excerpts');
    expect(yMap.get('displayName')).toBe('Source excerpts');

    frame.setPageLayout('vertical');
    expect(frame.pageLayout).toBe('vertical');
    expect(yMap.get('pageLayout')).toBe('vertical');
  });

  it('falls back to the default display name for blank or missing values', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-uuid-3', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
    const frame = new PageFrameElement('frame-uuid-3');

    frame.bindToYMap(yMap);
    expect(frame.displayName).toBe(DEFAULT_PAGE_FRAME_DISPLAY_NAME);

    frame.setDisplayName('');
    expect(frame.displayName).toBe(DEFAULT_PAGE_FRAME_DISPLAY_NAME);
    expect(yMap.get('displayName')).toBeUndefined();

    yMap.set('displayName', '  ');
    frame.syncFromYMap(['displayName']);
    expect(frame.displayName).toBe(DEFAULT_PAGE_FRAME_DISPLAY_NAME);
  });

  it('opens frames saved with the removed horizontal layout as pages', () => {
    const frame = new PageFrameElement('frame-uuid-4');
    const yMap = new Y.Doc().getMap<unknown>('frame');
    yMap.set('pageLayout', 'horizontal');

    frame.bindToYMap(yMap);
    frame.numPages = 3;

    expect(frame.pageLayout).toBe('vertical');
    expect(frame.totalWidth).toBe(PAGE_WIDTH);
    expect(frame.totalHeight).toBe(PAGE_HEIGHT * 3 + PAGE_GAP * 2);
  });
});
