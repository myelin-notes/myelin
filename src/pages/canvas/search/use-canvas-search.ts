import { type RefObject, useCallback, useMemo, useState } from 'react';
import { useKeybindings } from '@/hooks/useKeybindings';
import { handwritingService } from '@/lib/handwriting';
import type { ActionBinding } from '@/lib/keybinds';
import { searchItems } from '@/lib/search';
import type { VFSNodeId } from '@/lib/sync';
import type { DrawableCanvas } from '../drawable-canvas';
import { type CanvasSearchItem, collectCanvasSearchItems } from './collect';

const RESULT_LIMIT = 50;

export interface CanvasSearchController {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  results: CanvasSearchItem[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  selectResult: (item: CanvasSearchItem) => void;
  close: () => void;
}

/**
 * In-canvas search. Cmd/Ctrl+F opens a find overlay that matches text, page
 * frames, audio transcripts (read live from the doc) and handwriting (from the
 * recognized artifact). Activating a result pans the viewport to it and selects
 * the underlying element(s).
 */
export function useCanvasSearch(
  drawableCanvasRef: RefObject<DrawableCanvas | null>,
  nodeId: VFSNodeId,
): CanvasSearchController {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [items, setItems] = useState<CanvasSearchItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const openSearch = useCallback(() => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    setOpen(true);
    setQueryState('');
    setActiveIndex(0);
    // Element text is available synchronously; handwriting is read from disk
    // and merged in once it resolves.
    setItems(collectCanvasSearchItems(dc, null));
    void handwritingService.readPage(nodeId).then((page) => {
      const current = drawableCanvasRef.current;
      if (current) {
        setItems(collectCanvasSearchItems(current, page));
      }
    });
  }, [drawableCanvasRef, nodeId]);

  const close = useCallback(() => {
    setOpen(false);
    setQueryState('');
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setActiveIndex(0);
  }, []);

  const results = useMemo(() => {
    if (!open || !query.trim()) {
      return [];
    }
    return searchItems(items, query, {
      getId: (item) => item.id,
      fields: [{ name: 'text', getValue: (item) => item.text }],
      limit: RESULT_LIMIT,
    }).map((hit) => hit.item);
  }, [open, query, items]);

  const selectResult = useCallback(
    (item: CanvasSearchItem) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      dc.clearSelection();
      if (item.selectUuids.length > 0) {
        dc.selectElementsByUuid(item.selectUuids);
      }
      const { x, y, width, height } = item.rect;
      dc.viewport.animateViewToFitRect(new DOMRect(x, y, width, height), {
        widthRatio: 0.72,
        heightRatio: 0.82,
      });
      close();
    },
    [drawableCanvasRef, close],
  );

  const bindings = useMemo<ActionBinding[]>(
    () => [
      {
        action: 'canvas:find',
        // Find should open even while typing in a page frame.
        allowEditable: true,
        onDown: (event) => {
          event.preventDefault();
          openSearch();
        },
      },
    ],
    [openSearch],
  );
  useKeybindings(bindings);

  return {
    open,
    query,
    setQuery,
    results,
    activeIndex,
    setActiveIndex,
    selectResult,
    close,
  };
}
