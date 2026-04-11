import { useEffect, useRef } from 'react';
import type { DrawableCanvas } from '../../drawable-canvas';
import type { DrawableElement } from '../../elements/drawable-element';
import { ElementType } from '../../elements/element-type';
import {
  PAGE_PADDING,
  PAGE_WIDTH,
  type PageFrameElement,
} from '../../elements/page-frame-element';
import { PM_EDITOR_CLASS, PM_UPDATE_EVENT } from '../pm/constants';
import { FloatingToolbar } from '../pm/floating-toolbar';

const FRAME_STYLE: Record<string, string> = {
  transformOrigin: '0 0',
  position: 'absolute',
  left: '0px',
  top: '0px',
  width: `${PAGE_WIDTH}px`,
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
  frameDiv: HTMLDivElement;
  contentDiv: HTMLDivElement;
}

function createFrameRefs(
  frame: PageFrameElement,
  container: HTMLDivElement,
): FrameRefs {
  const frameDiv = document.createElement('div');
  Object.assign(frameDiv.style, FRAME_STYLE);
  frameDiv.dataset.frameIndex = String(frame.index);

  const contentDiv = document.createElement('div');
  Object.assign(contentDiv.style, CONTENT_STYLE);
  contentDiv.classList.add(PM_EDITOR_CLASS);

  frameDiv.appendChild(contentDiv);
  container.appendChild(frameDiv);

  frame.pmEditor.createView(contentDiv, (pageCount) => {
    frame.numPages = pageCount;
  });

  return { frameDiv, contentDiv };
}

function removeStaleFrames(
  frameMap: Map<number, FrameRefs>,
  activeIndices: Set<number>,
): void {
  for (const [index, refs] of frameMap) {
    if (!activeIndices.has(index)) {
      refs.frameDiv.remove();
      frameMap.delete(index);
    }
  }
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
  const activeView = editingElement?.pmEditor.view ?? null;

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
        const screenX = (frame.offset.x + offset.x) * zoom;
        const screenY = (frame.offset.y + offset.y) * zoom;
        refs.frameDiv.style.height = `${frame.totalHeight}px`;
        refs.frameDiv.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
        refs.frameDiv.style.pointerEvents = frame.editing ? 'auto' : '';
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
    const view = editingElement.pmEditor.view;
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

      const margin = 120;
      const viewportTop = margin;
      const viewportBottom = window.innerHeight - margin;

      let dy = 0;
      if (rect.bottom > viewportBottom) {
        dy = (viewportBottom - rect.bottom) / dc.viewport.zoom;
      } else if (rect.top < viewportTop) {
        dy = (viewportTop - rect.top) / dc.viewport.zoom;
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

  return (
    <>
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 2,
        }}
      />
      {activeView && <FloatingToolbar view={activeView} />}
    </>
  );
}
