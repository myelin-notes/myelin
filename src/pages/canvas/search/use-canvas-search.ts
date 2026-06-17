import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useKeybindings } from '@/hooks/useKeybindings';
import { handwritingService } from '@/lib/handwriting';
import type { ActionBinding } from '@/lib/keybinds';
import type { VFSNodeId } from '@/lib/sync';
import type { DrawableCanvas } from '../drawable-canvas';
import { PageFrameElement } from '../elements/page-frame-element';
import {
  clearSearchHighlight,
  setSearchHighlight,
} from '../page-frame/pm/search-highlight';
import {
  buildCanvasMatches,
  type CanvasMatch,
  type CanvasSearchSource,
  collectCanvasSearchSources,
} from './collect';

/** Frames to keep retrying the highlight while a panned-to frame's view mounts. */
const HIGHLIGHT_MOUNT_RETRY_FRAMES = 60;

export interface CanvasSearchController {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** Total matches for the current query. */
  total: number;
  /** 1-based index of the current match, or 0 when there are none. */
  current: number;
  next: () => void;
  prev: () => void;
  close: () => void;
}

/**
 * In-canvas find, browser-style. Cmd/Ctrl+F opens a find bar that matches text,
 * page frames, audio transcripts (live from the doc) and handwriting (from the
 * recognized artifact). Matches are a flat ordered list stepped through with
 * next/prev; each step pans to the match and, for page frames, highlights the
 * current occurrence inside the frame.
 */
export function useCanvasSearch(
  drawableCanvasRef: RefObject<DrawableCanvas | null>,
  nodeId: VFSNodeId,
): CanvasSearchController {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [sources, setSources] = useState<CanvasSearchSource[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  /** The page frame currently showing a match highlight, if any. */
  const highlightedFrameRef = useRef<string | null>(null);

  const matches = useMemo(
    () => buildCanvasMatches(sources, query),
    [sources, query],
  );
  const matchesRef = useRef<CanvasMatch[]>(matches);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  const frameView = useCallback(
    (uuid: string) => {
      const element = drawableCanvasRef.current?.getElementByUuid(uuid);
      return element instanceof PageFrameElement
        ? (element.pmEditor?.view ?? null)
        : null;
    },
    [drawableCanvasRef],
  );

  const clearActiveHighlight = useCallback(() => {
    const uuid = highlightedFrameRef.current;
    if (!uuid) {
      return;
    }
    highlightedFrameRef.current = null;
    const view = frameView(uuid);
    if (view) {
      clearSearchHighlight(view);
    }
  }, [frameView]);

  const highlightFrame = useCallback(
    (frameUuid: string, q: string, ordinal: number) => {
      // Clear a different frame that was previously highlighted.
      const previous = highlightedFrameRef.current;
      if (previous && previous !== frameUuid) {
        const previousView = frameView(previous);
        if (previousView) {
          clearSearchHighlight(previousView);
        }
      }
      highlightedFrameRef.current = frameUuid;

      let frames = 0;
      const apply = () => {
        // A newer navigation (or a clear) superseded this request.
        if (highlightedFrameRef.current !== frameUuid) {
          return;
        }
        const view = frameView(frameUuid);
        if (view) {
          setSearchHighlight(view, q, ordinal);
          return;
        }
        // The frame's editor mounts as it pans into view; retry briefly.
        if (frames++ < HIGHLIGHT_MOUNT_RETRY_FRAMES) {
          requestAnimationFrame(apply);
        }
      };
      apply();
    },
    [frameView],
  );

  const navigateToMatch = useCallback(
    (match: CanvasMatch, q: string) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      if (match.kind === 'page-frame' && match.frameUuid) {
        highlightFrame(match.frameUuid, q, match.ordinalInFrame ?? 0);
      } else {
        clearActiveHighlight();
      }
      dc.clearSelection();
      if (match.selectUuids.length > 0) {
        dc.selectElementsByUuid(match.selectUuids);
      }
      const { x, y, width, height } = match.rect;
      dc.viewport.animateViewToFitRect(new DOMRect(x, y, width, height), {
        widthRatio: 0.72,
        heightRatio: 0.82,
      });
    },
    [drawableCanvasRef, highlightFrame, clearActiveHighlight],
  );

  // Keep the viewport/highlight in sync with the current match.
  useEffect(() => {
    if (!open) {
      return;
    }
    const match = matches[currentIndex];
    if (match) {
      navigateToMatch(match, query);
    } else {
      clearActiveHighlight();
    }
  }, [
    open,
    currentIndex,
    matches,
    query,
    navigateToMatch,
    clearActiveHighlight,
  ]);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setQueryState('');
  }, []);

  const openSearch = useCallback(() => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    clearActiveHighlight();
    setOpen(true);
    setQueryState('');
    setCurrentIndex(0);
    setSources(collectCanvasSearchSources(dc, null));
    // Handwriting is read from disk and merged in once it resolves.
    void handwritingService.readPage(nodeId).then((page) => {
      const current = drawableCanvasRef.current;
      if (current) {
        setSources(collectCanvasSearchSources(current, page));
      }
    });
  }, [drawableCanvasRef, nodeId, clearActiveHighlight]);

  const close = useCallback(() => {
    clearActiveHighlight();
    closeOverlay();
  }, [clearActiveHighlight, closeOverlay]);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setCurrentIndex(0);
  }, []);

  const next = useCallback(() => {
    const count = matchesRef.current.length;
    if (count > 0) {
      setCurrentIndex((index) => (index + 1) % count);
    }
  }, []);

  const prev = useCallback(() => {
    const count = matchesRef.current.length;
    if (count > 0) {
      setCurrentIndex((index) => (index - 1 + count) % count);
    }
  }, []);

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
    total: matches.length,
    current: matches.length > 0 ? currentIndex + 1 : 0,
    next,
    prev,
    close,
  };
}
