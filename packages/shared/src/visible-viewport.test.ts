import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getVisibleElementBounds,
  getVisibleViewportBounds,
} from './visible-viewport';

const FULL_SCREEN = { width: 1024, height: 640, offsetLeft: 0, offsetTop: 0 };

function stubWindow(
  visualViewport: typeof FULL_SCREEN,
  padding: { top?: number; bottom?: number } = {},
) {
  vi.stubGlobal('window', {
    innerWidth: 1024,
    innerHeight: 640,
    visualViewport,
  });
  vi.stubGlobal('document', { getElementById: () => ({}) });
  vi.stubGlobal('getComputedStyle', () => ({
    paddingTop: `${padding.top ?? 0}px`,
    paddingRight: '0px',
    paddingBottom: `${padding.bottom ?? 0}px`,
    paddingLeft: '0px',
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('visible viewport bounds', () => {
  it('stops at the system bars when the window runs under them', () => {
    stubWindow(FULL_SCREEN, { top: 26, bottom: 38 });
    expect(getVisibleViewportBounds()).toEqual({
      left: 0,
      top: 26,
      right: 1024,
      bottom: 602,
    });
  });

  it('stops at an open keyboard without also subtracting the bar it covers', () => {
    stubWindow({ ...FULL_SCREEN, height: 400 }, { bottom: 38 });
    expect(getVisibleViewportBounds().bottom).toBe(400);
  });

  it('clips an element that extends past the visible area', () => {
    stubWindow(FULL_SCREEN, { bottom: 38 });
    const element = {
      getBoundingClientRect: () => ({
        left: 300,
        top: 62,
        right: 1024,
        bottom: 640,
      }),
    } as Element;
    expect(getVisibleElementBounds(element)).toEqual({
      left: 300,
      top: 62,
      right: 1024,
      bottom: 602,
    });
  });
});
