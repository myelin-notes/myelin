import { useCallback, useEffect, useRef } from 'react';
import type { DrawableCanvas } from '../../drawable-canvas';
import type { PageFrameElement } from '../../elements/page-frame-element';
import type { EditableBlock } from '../block-editor';
import { blocksToDOM, domToBlocks } from './block-dom';
import { checkMarkdownShortcut, handleEnterKey } from './block-editing';
import { flatStyle } from './flat-style';
import {
  CONTENT_STYLE,
  FRAME_STYLE,
  type FrameRefs,
  paginateFrame,
} from './pagination';

// ── Component ────────────────────────────────────────────────

interface PageFrameDomLayerProps {
  canvasRef: React.RefObject<DrawableCanvas | null>;
  editingElement: PageFrameElement | null;
  onCommitEdit: (blocks: EditableBlock[]) => void;
}

export function PageFrameDomLayer({
  canvasRef,
  editingElement,
  onCommitEdit,
}: PageFrameDomLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameMap = useRef<Map<number, FrameRefs>>(new Map());
  const blockSnapshotsMap = useRef<Map<number, string>>(new Map());

  const commitEdit = useCallback(() => {
    if (!editingElement) {
      return;
    }
    const refs = frameMap.current.get(editingElement.index);
    if (refs) {
      const blocks = domToBlocks(refs.contentDiv);
      onCommitEdit(blocks);
    }
  }, [editingElement, onCommitEdit]);

  // Sync loop — every frame: create/remove/position frame DOM elements
  useEffect(() => {
    let rafId: number;
    const editingRef = { current: editingElement };
    editingRef.current = editingElement;

    function sync() {
      const dc = canvasRef.current;
      const container = containerRef.current;
      if (!(dc && container)) {
        rafId = requestAnimationFrame(sync);
        return;
      }

      const zoom = dc.zoom;
      const offset = dc.viewOffset;
      const frames = dc.pageFrames;
      const existingIndices = new Set<number>();

      for (const frame of frames) {
        existingIndices.add(frame.index);

        if (!frameMap.current.has(frame.index)) {
          const frameDiv = document.createElement('div');
          Object.assign(frameDiv.style, flatStyle(FRAME_STYLE));
          frameDiv.dataset.frameIndex = String(frame.index);

          const contentDiv = document.createElement('div');
          Object.assign(contentDiv.style, flatStyle(CONTENT_STYLE));
          contentDiv.contentEditable = 'false';

          frameDiv.appendChild(contentDiv);
          container.appendChild(frameDiv);

          const refs: FrameRefs = { frameDiv, contentDiv, chromeDivs: [] };
          frameMap.current.set(frame.index, refs);

          const blocks = frame.editor.blocks;
          blocksToDOM(contentDiv, blocks);
          blockSnapshotsMap.current.set(frame.index, JSON.stringify(blocks));

          paginateFrame(refs, frame);
        } else if (editingRef.current?.index !== frame.index) {
          const blocks = frame.editor.blocks;
          const snap = JSON.stringify(blocks);
          if (blockSnapshotsMap.current.get(frame.index) !== snap) {
            const refs = frameMap.current.get(frame.index)!;
            blocksToDOM(refs.contentDiv, blocks);
            blockSnapshotsMap.current.set(frame.index, snap);
            paginateFrame(refs, frame);
          }
        }

        // Position
        const refs = frameMap.current.get(frame.index)!;
        const screenX = (frame.offset.x + offset.x) * zoom;
        const screenY = (frame.offset.y + offset.y) * zoom;
        refs.frameDiv.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
      }

      for (const [index, refs] of frameMap.current) {
        if (!existingIndices.has(index)) {
          refs.frameDiv.remove();
          frameMap.current.delete(index);
          blockSnapshotsMap.current.delete(index);
        }
      }

      // When contentEditable elements are focused, the browser may scroll
      // this overflow:hidden container to keep the cursor visible. Absorb
      // that scroll into the canvas viewport offset so the canvas selection
      // overlay stays in sync with the DOM layer.
      if (container.scrollTop !== 0 || container.scrollLeft !== 0) {
        dc.panBy(-container.scrollLeft / zoom, -container.scrollTop / zoom);
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }

      rafId = requestAnimationFrame(sync);
    }

    rafId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(rafId);
  }, [canvasRef, editingElement]);

  // Handle editing state changes
  useEffect(() => {
    if (!editingElement) {
      for (const [, refs] of frameMap.current) {
        refs.contentDiv.contentEditable = 'false';
        refs.frameDiv.style.zIndex = '';
        refs.frameDiv.style.pointerEvents = '';
      }
      return;
    }

    const refs = frameMap.current.get(editingElement.index);
    if (!refs) {
      return;
    }

    refs.frameDiv.style.zIndex = '10';
    refs.frameDiv.style.pointerEvents = 'auto';
    refs.contentDiv.contentEditable = 'true';

    const dc = canvasRef.current;
    if (dc) {
      dc.setGetEditingBlocks(() => domToBlocks(refs.contentDiv));
    }

    // Focus and place cursor at end of the last block
    refs.contentDiv.focus();
    const sel = window.getSelection();
    if (sel && refs.contentDiv.lastElementChild) {
      const lastBlock = refs.contentDiv.lastElementChild;
      const range = document.createRange();
      range.selectNodeContents(lastBlock);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const repaginate = () => paginateFrame(refs, editingElement);
    const handleInput = () => {
      const focusNode = window.getSelection()?.focusNode;
      if (focusNode) {
        let div: HTMLDivElement | null = null;
        let n: Node | null = focusNode;
        while (n && n !== refs.contentDiv) {
          if (
            n instanceof HTMLDivElement &&
            n.parentElement === refs.contentDiv
          ) {
            div = n;
            break;
          }
          n = n.parentNode;
        }
        if (div) {
          checkMarkdownShortcut(div);
        }
      }
      repaginate();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        commitEdit();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        handleEnterKey(e, refs.contentDiv);
        repaginate();
        return;
      }
    };

    refs.contentDiv.addEventListener('input', handleInput);
    refs.contentDiv.addEventListener('keydown', handleKeyDown);

    repaginate();

    return () => {
      refs.contentDiv.removeEventListener('input', handleInput);
      refs.contentDiv.removeEventListener('keydown', handleKeyDown);
      // Sync snapshot so the rAF loop won't tear down & rebuild the
      // DOM that was just edited — it already has the correct content.
      blockSnapshotsMap.current.set(
        editingElement.index,
        JSON.stringify(editingElement.editor.blocks),
      );
    };
  }, [editingElement, commitEdit, canvasRef]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    />
  );
}
