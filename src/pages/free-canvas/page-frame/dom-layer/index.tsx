import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { DrawableCanvas } from '../../drawable-canvas';
import type { DrawableElement } from '../../elements/drawable-element';
import { ElementType } from '../../elements/element-type';
import {
  PAGE_PADDING,
  PAGE_WIDTH,
  type PageFrameElement,
} from '../../elements/page-frame-element';
import { FloatingToolbar } from '../pm/floating-toolbar';

// ── Style constants ────────────────────────────────────────

const FRAME_STYLE: Record<string, string> = {
  transformOrigin: '0 0',
  position: 'absolute',
  left: '0px',
  top: '0px',
  width: `${PAGE_WIDTH}px`,
  overflow: 'hidden',
};

const CONTENT_STYLE: Record<string, string> = {
  position: 'relative',
  padding: `${PAGE_PADDING}px`,
  outline: 'none',
};

// ── Types ──────────────────────────────────────────────────

interface FrameRefs {
  frameDiv: HTMLDivElement;
  contentDiv: HTMLDivElement;
}

// ── Component ──────────────────────────────────────────────

interface PageFrameDomLayerProps {
  canvasRef: React.RefObject<DrawableCanvas | null>;
  editingElement: DrawableElement | null;
  onCommitEdit: () => void;
}

export function PageFrameDomLayer({
  canvasRef,
  editingElement: rawEditingElement,
  onCommitEdit,
}: PageFrameDomLayerProps) {
  const editingElement =
    rawEditingElement?.type === ElementType.PAGE_FRAME
      ? (rawEditingElement as PageFrameElement)
      : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const frameMap = useRef<Map<number, FrameRefs>>(new Map());
  const [activeView, setActiveView] = useState<EditorView | null>(null);

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

      const zoom = dc.zoom;
      const offset = dc.viewOffset;
      const frames = dc.getElementsByType(
        ElementType.PAGE_FRAME,
      ) as PageFrameElement[];
      const existingIndices = new Set<number>();

      for (const frame of frames) {
        existingIndices.add(frame.index);

        if (!frameMap.current.has(frame.index)) {
          // Create frame container + persistent EditorView
          const frameDiv = document.createElement('div');
          Object.assign(frameDiv.style, FRAME_STYLE);
          frameDiv.dataset.frameIndex = String(frame.index);

          const contentDiv = document.createElement('div');
          Object.assign(contentDiv.style, CONTENT_STYLE);
          contentDiv.classList.add('pm-editor');

          frameDiv.appendChild(contentDiv);
          container.appendChild(frameDiv);

          const refs: FrameRefs = { frameDiv, contentDiv };
          frameMap.current.set(frame.index, refs);

          // Pagination is handled by a ProseMirror plugin (widget decorations).
          // The callback keeps frame.numPages in sync.
          frame.pmEditor.createView(contentDiv, (n) => {
            frame.numPages = n;
          });
        }

        const refs = frameMap.current.get(frame.index)!;
        const screenX = (frame.offset.x + offset.x) * zoom;
        const screenY = (frame.offset.y + offset.y) * zoom;
        refs.frameDiv.style.height = `${frame.totalHeight}px`;
        refs.frameDiv.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
      }

      // Clean up removed frames
      for (const [index, refs] of frameMap.current) {
        if (!existingIndices.has(index)) {
          refs.frameDiv.remove();
          frameMap.current.delete(index);
        }
      }

      // Absorb browser scroll from contentEditable focus
      if (container.scrollTop !== 0 || container.scrollLeft !== 0) {
        dc.panBy(-container.scrollLeft / zoom, -container.scrollTop / zoom);
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }

      rafId = requestAnimationFrame(sync);
    }

    rafId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef]);

  // Toggle editing state (pointer-events, toolbar, click-outside)
  useEffect(() => {
    if (!editingElement) {
      for (const [, refs] of frameMap.current) {
        refs.frameDiv.style.pointerEvents = '';
      }
      setActiveView(null);
      return;
    }

    const refs = frameMap.current.get(editingElement.index);
    if (!refs) {
      return;
    }

    // The foreground canvas has pointer-events:none (set by DrawableCanvas),
    // so the editing frame naturally receives events without z-index promotion.
    refs.frameDiv.style.pointerEvents = 'auto';
    setActiveView(editingElement.pmEditor.view);

    // Escape exits edit mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCommitEdit();
      }
    };
    refs.contentDiv.addEventListener('keydown', handleKeyDown);

    // Click outside exits edit mode (deferred to avoid catching the initiating click)
    const handlePointerDown = (e: PointerEvent) => {
      if (!refs.frameDiv.contains(e.target as Node)) {
        onCommitEdit();
      }
    };
    const rafId = requestAnimationFrame(() => {
      document.addEventListener('pointerdown', handlePointerDown);
    });

    return () => {
      cancelAnimationFrame(rafId);
      refs.contentDiv.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [editingElement, onCommitEdit]);

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
