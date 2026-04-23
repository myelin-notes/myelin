import { useEffect, useRef } from 'react';
import type { DrawableCanvas } from '../../drawable-canvas';
import type { DrawableElement } from '../../elements/drawable-element';
import { ElementType } from '../../elements/element-type';
import { FrameChrome } from '../../elements/frame-chrome';
import {
  PAGE_CORNER_RADIUS,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_PADDING,
  type PageFrameElement,
} from '../../elements/page-frame-element';
import { PM_EDITOR_CLASS, PM_UPDATE_EVENT } from '../pm/constants';
import { FloatingToolbar } from '../pm/floating-toolbar';

const FRAME_STYLE: Record<string, string> = {
  transformOrigin: '0 0',
  position: 'absolute',
  left: '0px',
  top: '0px',
  overflow: 'hidden',
};

const VIEWPORT_STYLE: Record<string, string> = {
  transformOrigin: '0 0',
  position: 'absolute',
  left: '0px',
  top: '0px',
  overflow: 'hidden',
};

const CONTENT_STYLE: Record<string, string> = {
  // Fill the entire frame so clicks anywhere on the page reach PM. With
  // auto height, an empty document only covers the top ~120px (one
  // paragraph + padding) and the rest of the page falls outside the
  // contenteditable area.
  position: 'absolute',
  inset: '0',
  padding: `${PAGE_PADDING}px`,
};

interface FrameRefs {
  chrome: FrameChrome;
  frameDiv: HTMLDivElement;
  viewportDiv: HTMLDivElement;
  contentDiv: HTMLDivElement;
  pageChromeDivs: HTMLDivElement[];
}

const PAGE_CHROME_STYLE: Record<string, string> = {
  position: 'absolute',
  left: '0px',
  height: `${PAGE_HEIGHT}px`,
  background: '#ffffff',
  borderRadius: `${PAGE_CORNER_RADIUS}px`,
  boxShadow: '0 4px 24px rgba(25, 28, 30, 0.08)',
  border: '0.5px solid rgba(195, 199, 202, 0.2)',
  pointerEvents: 'none',
};

function snapToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

function syncPageChrome(
  refs: FrameRefs,
  numPages: number,
  pageWidth: number,
): void {
  while (refs.pageChromeDivs.length < numPages) {
    const div = document.createElement('div');
    Object.assign(div.style, PAGE_CHROME_STYLE);
    refs.viewportDiv.insertBefore(div, refs.contentDiv);
    refs.pageChromeDivs.push(div);
  }
  while (refs.pageChromeDivs.length > numPages) {
    refs.pageChromeDivs.pop()!.remove();
  }
  for (let p = 0; p < numPages; p++) {
    refs.pageChromeDivs[p].style.top = `${p * (PAGE_HEIGHT + PAGE_GAP)}px`;
    refs.pageChromeDivs[p].style.width = `${pageWidth}px`;
  }
}

function createFrameRefs(
  frame: PageFrameElement,
  container: HTMLDivElement,
): FrameRefs {
  const chrome = new FrameChrome({
    kindLabel: 'NOTE',
    getMenuItems: () => frame.getMenuItems(),
  });

  const frameDiv = document.createElement('div');
  Object.assign(frameDiv.style, FRAME_STYLE);

  const viewportDiv = document.createElement('div');
  Object.assign(viewportDiv.style, VIEWPORT_STYLE);

  const contentDiv = document.createElement('div');
  Object.assign(contentDiv.style, CONTENT_STYLE);
  contentDiv.classList.add(PM_EDITOR_CLASS);

  viewportDiv.appendChild(contentDiv);
  frameDiv.appendChild(viewportDiv);
  chrome.contentSlot.appendChild(frameDiv);
  container.appendChild(chrome.root);

  frame.mountDOM(frameDiv, contentDiv);
  frame.pmEditor?.createView(contentDiv, (pageCount) => {
    frame.numPages = pageCount;
  });

  return { chrome, frameDiv, viewportDiv, contentDiv, pageChromeDivs: [] };
}

function removeStaleFrames(
  frameMap: Map<number, FrameRefs>,
  activeIndices: Set<number>,
): void {
  for (const [index, refs] of frameMap) {
    if (!activeIndices.has(index)) {
      refs.chrome.dispose();
      frameMap.delete(index);
    }
  }
}

function shouldPreserveExternalFocus(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.closest('[role="dialog"]') !== null ||
    target.closest('[data-page-frame-preserve-focus]') !== null
  );
}

interface PageFrameDomLayerProps {
  canvasRef: React.RefObject<DrawableCanvas | null>;
  editingElement: DrawableElement | null;
}

export function PageFrameDomLayer({
  canvasRef,
  editingElement: rawEditingElement,
}: PageFrameDomLayerProps) {
  const editingElement =
    rawEditingElement?.type === ElementType.PAGE_FRAME
      ? (rawEditingElement as PageFrameElement)
      : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const frameMap = useRef<Map<number, FrameRefs>>(new Map());
  // Views are created eagerly inside createFrameRefs when a page frame first
  // appears on the canvas — so by the time editingElement is set, the view
  // already exists. Read it inline rather than tracking in state.
  const activeView = editingElement?.pmEditor?.view ?? null;

  // Sync loop — create/remove/position frame containers each frame
  useEffect(() => {
    let rafId: number;

    function sync() {
      const dc = canvasRef.current;
      const container = containerRef.current;
      if (!(dc && container)) {
        rafId = requestAnimationFrame(sync);
        return;
      }

      const zoom = dc.viewport.zoom;
      const offset = dc.viewport.offset;
      const frames = dc.getElementsByType(
        ElementType.PAGE_FRAME,
      ) as PageFrameElement[];
      const existingIndices = new Set<number>();

      for (const frame of frames) {
        existingIndices.add(frame.index);

        if (!frameMap.current.has(frame.index)) {
          frameMap.current.set(frame.index, createFrameRefs(frame, container));
        }

        const refs = frameMap.current.get(frame.index)!;
        const screenX = snapToDevicePixel((frame.offset.x + offset.x) * zoom);
        const screenY = snapToDevicePixel((frame.offset.y + offset.y) * zoom);

        const pageWidth = frame.pageWidth;
        refs.chrome.sync({
          screenX,
          screenY,
          contentWidth: pageWidth,
          contentHeight: frame.totalHeight,
          zoom,
        });

        // Inner frame: screen-sized clip box, lives inside chrome contentSlot
        // so no extra translate needed — contentSlot positions it.
        refs.frameDiv.style.width = `${pageWidth * zoom}px`;
        refs.frameDiv.style.height = `${frame.totalHeight * zoom}px`;
        refs.frameDiv.style.transform = '';

        // Inner viewport: world-sized. A fixed CSS zoom of devicePixelRatio
        // tells WebKit to rasterise the compositing-layer backing store at
        // DPR² resolution, producing crisp text at every canvas zoom level.
        // Because the zoom value is constant, text metrics and line breaks
        // never change — the variable canvas zoom is handled entirely by
        // transform: scale(), which is a post-layout GPU operation.
        const dpr = window.devicePixelRatio || 1;
        refs.viewportDiv.style.width = `${pageWidth}px`;
        refs.viewportDiv.style.height = `${frame.totalHeight}px`;
        refs.viewportDiv.style.zoom = `${dpr}`;
        refs.viewportDiv.style.setProperty('--vp-zoom', `${dpr}`);
        refs.viewportDiv.style.transform = `scale(${zoom / dpr})`;

        refs.frameDiv.style.pointerEvents = frame.editing ? 'auto' : '';
        syncPageChrome(refs, frame.numPages, pageWidth);
      }

      removeStaleFrames(frameMap.current, existingIndices);

      // The browser may try to scrollIntoView the focused contentEditable on
      // its own. Zero those out so they don't accumulate, but DON'T convert
      // them into a canvas pan — the follow-cursor effect below is the
      // single source of truth for keeping the caret in view.
      if (container.scrollTop !== 0 || container.scrollLeft !== 0) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }

      rafId = requestAnimationFrame(sync);
    }

    rafId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef]);

  // Follow-cursor: keep the caret inside a margin-padded viewport while
  // editing. Fires on every PM transaction (typing, arrow-key navigation,
  // mark toggles) AND on browser-driven selectionchange (drag-select). This
  // is the single source of truth — the absorber above no longer pans.
  useEffect(() => {
    if (!editingElement) {
      return;
    }
    const view = editingElement.pmEditor?.view;
    if (!view) {
      return;
    }

    let pendingRaf = 0;
    const followCursor = () => {
      pendingRaf = 0;
      const dc = canvasRef.current;
      if (!dc || dc.viewport.isAnimatingView) {
        return;
      }
      const sel = view.state.selection;
      // coordsAtPos can throw if the position is stale (mid-transaction)
      let rect: { top: number; bottom: number };
      try {
        rect = view.coordsAtPos(sel.head);
      } catch {
        return;
      }

      // The viewport div has a fixed CSS zoom of DPR (not in
      // getBoundingClientRect) plus transform: scale(zoom/DPR) (IS in
      // getBoundingClientRect). Multiply by DPR to get screen coords.
      const zoom = dc.viewport.zoom;
      const dpr = window.devicePixelRatio || 1;
      const screenBottom = rect.bottom * dpr;
      const screenTop = rect.top * dpr;

      const margin = 120;
      const viewportTop = margin;
      const viewportBottom = window.innerHeight - margin;

      let dy = 0;
      if (screenBottom > viewportBottom) {
        dy = (viewportBottom - screenBottom) / zoom;
      } else if (screenTop < viewportTop) {
        dy = (viewportTop - screenTop) / zoom;
      }
      if (dy !== 0) {
        dc.viewport.panBy(0, dy);
      }
    };

    const schedule = () => {
      if (pendingRaf === 0) {
        pendingRaf = requestAnimationFrame(followCursor);
      }
    };

    view.dom.addEventListener(PM_UPDATE_EVENT, schedule);
    document.addEventListener('selectionchange', schedule);

    return () => {
      if (pendingRaf !== 0) {
        cancelAnimationFrame(pendingRaf);
      }
      view.dom.removeEventListener(PM_UPDATE_EVENT, schedule);
      document.removeEventListener('selectionchange', schedule);
    };
  }, [editingElement, canvasRef]);

  useEffect(() => {
    if (!editingElement) {
      return;
    }

    let pendingRaf = 0;
    const scheduleFocusCheck = () => {
      if (pendingRaf !== 0) {
        return;
      }
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = 0;
        if (!document.hasFocus()) {
          return;
        }
        if (shouldPreserveExternalFocus(document.activeElement)) {
          return;
        }
        editingElement.ensureEditorFocused();
      });
    };

    scheduleFocusCheck();
    document.addEventListener('focusin', scheduleFocusCheck, true);
    document.addEventListener('pointerup', scheduleFocusCheck, true);
    window.addEventListener('focus', scheduleFocusCheck);

    return () => {
      if (pendingRaf !== 0) {
        cancelAnimationFrame(pendingRaf);
      }
      document.removeEventListener('focusin', scheduleFocusCheck, true);
      document.removeEventListener('pointerup', scheduleFocusCheck, true);
      window.removeEventListener('focus', scheduleFocusCheck);
    };
  }, [editingElement]);

  return (
    <>
      <div
        id="page-frame-overlay"
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 5,
        }}
      />
      {activeView && <FloatingToolbar view={activeView} />}
    </>
  );
}
