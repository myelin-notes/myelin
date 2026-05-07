import { describe, expect, it, vi } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import {
  DEFAULT_PAGE_FRAME_DISPLAY_NAME,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from './page-frame-constants';
import { PageFrameElement } from './page-frame-element';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(),
}));

describe('PageFrameElement display name', () => {
  it('serializes the default display name when none is provided', () => {
    const frame = new PageFrameElement('frame-uuid-1');

    expect(frame.displayName).toBe(DEFAULT_PAGE_FRAME_DISPLAY_NAME);
    expect(frame.getYMapProps()).toMatchObject({
      displayName: DEFAULT_PAGE_FRAME_DISPLAY_NAME,
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
  });

  it('hydrates and writes display name through the Yjs map', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-uuid-2', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      displayName: 'Research Notes',
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
    });
    const frame = new PageFrameElement('frame-uuid-2');

    frame.bindToYMap(yMap);
    expect(frame.displayName).toBe('Research Notes');

    frame.setDisplayName('  Source excerpts  ');
    expect(frame.displayName).toBe('Source excerpts');
    expect(yMap.get('displayName')).toBe('Source excerpts');
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
});
