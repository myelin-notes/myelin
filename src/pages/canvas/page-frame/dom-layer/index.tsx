import { useCallback, useEffect, useRef } from 'react';
import { PM_UPDATE_EVENT } from '@/lib/events';
import { getMessages } from '@/lib/i18n';
import { getDevicePixelRatio } from '@/lib/utils';
import type { DrawableCanvas } from '../../drawable-canvas';
import type { DrawableElement } from '../../elements/drawable-element';
import { ElementType } from '../../elements/element-type';
import { FrameChrome } from '../../elements/frame/chrome';
import { getFrameChromeMenuButtonRect } from '../../elements/frame/chrome-layout';
import type { PageLayout } from '../../elements/page-frame-constants';
import {
  PAGE_CORNER_RADIUS,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_PADDING,
  type PageFrameElement,
} from '../../elements/page-frame-element';
import type {
  NoteLinkPreview,
  NoteLinkPreviewTarget,
} from '../note-link/preview';
import {
  type NoteLinkPreviewHit,
  NoteLinkPreviewPopover,
} from '../note-link/preview-popover';
import type {
  PageFrameAutocompleteController,
  PageFrameAutocompleteItem,
} from '../pm/autocomplete';
import { PageFrameAutocompletePopup } from '../pm/autocomplete/popup';
import { CodeRunOverlayLayer } from '../pm/code-block/run-overlay';
import { PM_EDITOR_CLASS } from '../pm/constants';
import { FloatingToolbar } from '../pm/floating-toolbar';
import { NOTE_LINK_SELECTOR } from '../pm/markdown/note-links';
import { positionMathBlockSources } from '../pm/math/block-node-view';
import {
  getPageFramePmScreenRectForNestedCaret,
  getPageFramePmScreenRectForPos,
} from '../pm/screen-rect';
import type { PageFrameAutocompleteKind } from '../use-page-frame-autocomplete';

// `clip` rather than `hidden`: hidden boxes are still programmatically
// scrollable, so the browser's caret-reveal (and PM's scrollIntoView) can
// scroll them when an overlay pokes past the clip edge — shifting the page
// inside its chrome. Clip boxes can't scroll at all.
const FRAME_STYLE: Record<string, string> = {
  transformOrigin: '0 0',
  position: 'absolute',
  left: '0px',
  top: '0px',
  overflow: 'clip',
};

const VIEWPORT_STYLE: Record<string, string> = {
  transformOrigin: '0 0',
  position: 'absolute',
  left: '0px',
  top: '0px',
  overflow: 'clip',
};

const CONTENT_STYLE: Record<string, string> = {
  // Fill the entire frame so clicks anywhere on the page reach PM. With
  // auto height, an empty document only covers the top ~120px (one
  // paragraph + padding) and the rest of the page falls outside the
  // contenteditable area.
  position: 'absolute',
  inset: '0',
  boxSizing: 'border-box',
  padding: `${PAGE_PADDING}px`,
};

interface FrameRefs {
  frame: PageFrameElement;
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
  background: 'var(--bg-card)',
  borderRadius: `${PAGE_CORNER_RADIUS}px`,
  boxShadow: '0 4px 24px rgb(var(--shadow-rgb) / 0.08)',
  border: '1px solid var(--border-ghost)',
  pointerEvents: 'none',
};

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function snapToDevicePixel(value: number): number {
  const dpr = getDevicePixelRatio();
  return Math.round(value * dpr) / dpr;
}

function getScreenRect(
  rect: DOMRect,
  offset: { x: number; y: number },
  zoom: number,
): ScreenRect {
  const left = snapToDevicePixel((rect.x + offset.x) * zoom);
  const top = snapToDevicePixel((rect.y + offset.y) * zoom);
  return {
    left,
    top,
    right: left + rect.width * zoom,
    bottom: top + rect.height * zoom,
  };
}

function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

function isFrameMenuCoveredByHigherFrame(
  frameIndex: number,
  frames: PageFrameElement[],
  menuRect: ScreenRect,
  offset: { x: number; y: number },
  zoom: number,
): boolean {
  for (let i = frameIndex + 1; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.hidden) {
      continue;
    }
    if (
      rectsIntersect(menuRect, getScreenRect(frame.boundingBox, offset, zoom))
    ) {
      return true;
    }
  }
  return false;
}

function syncPageChrome(
  refs: FrameRefs,
  numPages: number,
  pageWidth: number,
  pageHeight: number,
  pageLayout: PageLayout,
  stripHeight: number,
): void {
  // Continuous layout is a single uninterrupted sheet sized to the whole strip,
  // not a run of fixed-height pages.
  const chromeCount = pageLayout === 'continuous' ? 1 : numPages;
  while (refs.pageChromeDivs.length < chromeCount) {
    const div = document.createElement('div');
    Object.assign(div.style, PAGE_CHROME_STYLE);
    refs.viewportDiv.insertBefore(div, refs.contentDiv);
    refs.pageChromeDivs.push(div);
  }
  while (refs.pageChromeDivs.length > chromeCount) {
    refs.pageChromeDivs.pop()!.remove();
  }
  for (let p = 0; p < chromeCount; p++) {
    refs.pageChromeDivs[p].style.left =
      pageLayout === 'horizontal' ? `${p * (pageWidth + PAGE_GAP)}px` : '0px';
    refs.pageChromeDivs[p].style.top =
      pageLayout === 'horizontal' ? '0px' : `${p * (pageHeight + PAGE_GAP)}px`;
    refs.pageChromeDivs[p].style.width = `${pageWidth}px`;
    refs.pageChromeDivs[p].style.height =
      pageLayout === 'continuous' ? `${stripHeight}px` : `${pageHeight}px`;
  }
}

function syncEditorLayout(
  refs: FrameRefs,
  pageWidth: number,
  pageHeight: number,
  pageLayout: PageLayout,
): void {
  // Same-value guard: this runs every frame from the sync loop, and the
  // pagination plugin (plus code-block node views) watch this attribute with
  // MutationObservers that fire on every write — unguarded, that schedules a
  // repagination pass every frame forever.
  if (refs.contentDiv.dataset.pageLayout !== pageLayout) {
    refs.contentDiv.dataset.pageLayout = pageLayout;
  }

  const editorDom = refs.frame.pmEditor?.view?.dom;
  if (!(editorDom instanceof HTMLElement)) {
    return;
  }

  if (pageLayout === 'horizontal') {
    const columnWidth = Math.max(1, pageWidth - PAGE_PADDING * 2);
    const columnHeight = Math.max(1, pageHeight - PAGE_PADDING * 2);
    editorDom.style.width = `${columnWidth}px`;
    editorDom.style.height = `${columnHeight}px`;
    editorDom.style.columnWidth = `${columnWidth}px`;
    editorDom.style.columnGap = `${PAGE_GAP + PAGE_PADDING * 2}px`;
    editorDom.style.columnFill = 'auto';
    editorDom.style.overflow = 'visible';
    return;
  }

  editorDom.style.removeProperty('width');
  editorDom.style.removeProperty('height');
  editorDom.style.removeProperty('column-width');
  editorDom.style.removeProperty('column-gap');
  editorDom.style.removeProperty('column-fill');
  editorDom.style.removeProperty('overflow');
}

function createFrameRefs(
  frame: PageFrameElement,
  container: HTMLDivElement,
): FrameRefs {
  const chrome = new FrameChrome({
    kindLabel: getMessages().canvas.frame.noteKind,
    getMenuItems: () => frame.getMenuItems(),
    onTitleCommit: (title) => {
      frame.setDisplayName(title);
      return frame.displayName;
    },
  });
  chrome.setFileName(frame.displayName);

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
  frame.pmEditor?.createView(contentDiv, (pageCount, contentHeight) => {
    frame.numPages = pageCount;
    frame.setMeasuredContentHeight(contentHeight);
  });

  return {
    frame,
    chrome,
    frameDiv,
    viewportDiv,
    contentDiv,
    pageChromeDivs: [],
  };
}

function disposeFrameRefs(refs: FrameRefs): void {
  refs.frame.pmEditor?.destroyView();
  refs.chrome.dispose();
}

function removeStaleFrames(
  frameMap: Map<string, FrameRefs>,
  activeFrames: ReadonlyMap<string, PageFrameElement>,
): void {
  for (const [uuid, refs] of frameMap) {
    if (activeFrames.get(uuid) !== refs.frame) {
      disposeFrameRefs(refs);
      frameMap.delete(uuid);
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

function rectContainsPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function getVisualRectForContentRect(refs: FrameRefs, rect: DOMRect): DOMRect {
  const contentRect = refs.contentDiv.getBoundingClientRect();
  const frameRect = refs.frameDiv.getBoundingClientRect();
  const scaleX =
    contentRect.width > 0 ? frameRect.width / contentRect.width : 1;
  const scaleY =
    contentRect.height > 0 ? frameRect.height / contentRect.height : 1;

  return new DOMRect(
    frameRect.left + (rect.left - contentRect.left) * scaleX,
    frameRect.top + (rect.top - contentRect.top) * scaleY,
    rect.width * scaleX,
    rect.height * scaleY,
  );
}

function unionRects(rects: DOMRect[]): DOMRect {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

function getNoteLinkPreviewTargetAtPoint(
  frameMap: ReadonlyMap<string, FrameRefs>,
  clientX: number,
  clientY: number,
): NoteLinkPreviewHit | null {
  for (const refs of frameMap.values()) {
    const contentRect = getVisualRectForContentRect(
      refs,
      refs.contentDiv.getBoundingClientRect(),
    );
    if (!rectContainsPoint(contentRect, clientX, clientY)) {
      continue;
    }

    for (const link of refs.contentDiv.querySelectorAll<HTMLElement>(
      NOTE_LINK_SELECTOR,
    )) {
      const linkRects = Array.from(link.getClientRects()).map((rect) =>
        getVisualRectForContentRect(refs, rect),
      );
      if (
        !linkRects.some((rect) => rectContainsPoint(rect, clientX, clientY))
      ) {
        continue;
      }

      const title = link.getAttribute('data-note-link-title');
      if (title === null) {
        continue;
      }

      const target: NoteLinkPreviewTarget = {
        title,
        noteId: link.getAttribute('data-note-id') || null,
      };
      return { target, rect: unionRects(linkRects) };
    }
  }

  return null;
}

interface PageFrameDomLayerProps {
  canvasRef: React.RefObject<DrawableCanvas | null>;
  editingElement: DrawableElement | null;
  autocompleteController?: PageFrameAutocompleteController | null;
  autocompleteKind?: PageFrameAutocompleteKind | null;
  onAutocompleteSelect?: (item: PageFrameAutocompleteItem) => void;
  loadNoteLinkPreview?: (
    target: NoteLinkPreviewTarget,
    signal: AbortSignal,
  ) => Promise<NoteLinkPreview | null>;
}

export function PageFrameDomLayer({
  canvasRef,
  editingElement: rawEditingElement,
  autocompleteController = null,
  autocompleteKind = null,
  onAutocompleteSelect,
  loadNoteLinkPreview,
}: PageFrameDomLayerProps) {
  const editingElement =
    rawEditingElement?.type === ElementType.PAGE_FRAME
      ? (rawEditingElement as PageFrameElement)
      : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const frameMap = useRef<Map<string, FrameRefs>>(new Map());
  const getPreviewTargetAtPoint = useCallback(
    (clientX: number, clientY: number) =>
      getNoteLinkPreviewTargetAtPoint(frameMap.current, clientX, clientY),
    [],
  );
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
      const viewAnimating = dc.viewport.isAnimatingView;
      const frames = dc.getElementsByType(
        ElementType.PAGE_FRAME,
      ) as PageFrameElement[];
      const activeFrames = new Map<string, PageFrameElement>();

      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const frame = frames[frameIndex];
        activeFrames.set(frame.uuid, frame);

        let refs = frameMap.current.get(frame.uuid);
        if (refs && refs.frame !== frame) {
          disposeFrameRefs(refs);
          frameMap.current.delete(frame.uuid);
          refs = undefined;
        }
        if (!refs) {
          refs = createFrameRefs(frame, container);
          frameMap.current.set(frame.uuid, refs);
        }
        const screenX = snapToDevicePixel((frame.offset.x + offset.x) * zoom);
        const screenY = snapToDevicePixel((frame.offset.y + offset.y) * zoom);

        const pageWidth = frame.pageWidth;
        const pageHeight = frame.pageHeight;
        const contentWidth = frame.totalWidth;
        const contentHeight = frame.totalHeight;
        const pageLayout = frame.pageLayout;
        if (dc.editingElement === frame) {
          dc.syncViewportEditModePan();
        }
        const menuRect = getFrameChromeMenuButtonRect({
          screenX,
          screenY,
          contentWidth,
          zoom,
        });
        refs.chrome.setFileName(frame.displayName);
        refs.chrome.sync({
          screenX,
          screenY,
          contentWidth,
          contentHeight,
          zoom,
          controlsVisible: !isFrameMenuCoveredByHigherFrame(
            frameIndex,
            frames,
            menuRect,
            offset,
            zoom,
          ),
        });

        // Inner frame: screen-sized clip box, lives inside chrome contentSlot
        // so no extra translate needed — contentSlot positions it.
        refs.frameDiv.style.width = `${contentWidth * zoom}px`;
        refs.frameDiv.style.height = `${contentHeight * zoom}px`;
        refs.frameDiv.style.transform = '';

        // Inner viewport: world-sized. A fixed CSS zoom of devicePixelRatio
        // tells WebKit to rasterise the compositing-layer backing store at
        // DPR² resolution, producing crisp text at every canvas zoom level.
        // Because the zoom value is constant, text metrics and line breaks
        // never change — the variable canvas zoom is handled entirely by
        // transform: scale(), which is a post-layout GPU operation.
        const dpr = getDevicePixelRatio();
        refs.viewportDiv.style.width = `${contentWidth}px`;
        refs.viewportDiv.style.height = `${contentHeight}px`;
        refs.viewportDiv.style.zoom = `${dpr}`;
        refs.viewportDiv.style.transform = `scale(${zoom / dpr})`;

        refs.frameDiv.style.pointerEvents = frame.editing ? 'auto' : '';
        // Editing chrome (the math source panel) is display:none while the
        // view animates: painting it mid-zoom roughly doubles the edit-enter
        // frame hitch, and it isn't readable until the camera lands anyway.
        // Same-value guard — observers aside, attribute writes dirty style.
        if ('viewAnimating' in refs.contentDiv.dataset !== viewAnimating) {
          if (viewAnimating) {
            refs.contentDiv.dataset.viewAnimating = '';
          } else {
            delete refs.contentDiv.dataset.viewAnimating;
            // The panel skipped its clamp while hidden (offsetHeight was 0);
            // re-clamp now that it's visible. No-op when nothing is editing.
            const editorDom = refs.frame.pmEditor?.view?.dom;
            if (editorDom instanceof HTMLElement) {
              positionMathBlockSources(editorDom);
            }
          }
        }
        syncEditorLayout(refs, pageWidth, pageHeight, pageLayout);
        syncPageChrome(
          refs,
          frame.numPages,
          pageWidth,
          pageHeight,
          pageLayout,
          contentHeight,
        );
      }

      removeStaleFrames(frameMap.current, activeFrames);

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
    return () => {
      cancelAnimationFrame(rafId);
      for (const refs of frameMap.current.values()) {
        disposeFrameRefs(refs);
      }
      frameMap.current.clear();
    };
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
    // Follow only when the caret actually moved (or the doc changed under
    // it). PM updates also fire for layout-only transactions; panning on
    // those would yank the viewport back to the caret while the user is
    // scrolling elsewhere in the frame.
    let lastHead = -1;
    let lastDoc = view.state.doc;
    // Selection moves placed by pointer don't pan: the user is pointing at
    // something already on screen. Without this, clicking a math block near
    // the viewport edge yanks the canvas — the click parks the caret at the
    // END of the LaTeX source, inside a panel that opens below the block and
    // off-screen. Track the pointer here rather than relying on PM's
    // `pointer` meta because the moves arrive as native selectionchange
    // events from the nested CodeMirror editors, not PM transactions.
    let pointerActive = false;
    let lastPointerUp = 0;
    const handlePointerDown = () => {
      pointerActive = true;
    };
    const handlePointerEnd = () => {
      pointerActive = false;
      lastPointerUp = performance.now();
    };
    // Grace period after pointerup: the click's selectionchange can land a
    // frame or two later.
    const POINTER_GRACE_MS = 150;
    const followCursor = () => {
      pendingRaf = 0;
      const dc = canvasRef.current;
      if (!dc || dc.viewport.isAnimatingView) {
        return;
      }
      const sel = view.state.selection;
      if (sel.head === lastHead && view.state.doc === lastDoc) {
        return;
      }
      if (
        pointerActive ||
        performance.now() - lastPointerUp < POINTER_GRACE_MS
      ) {
        // Commit as seen: the async math-source attach that follows a click
        // re-fires selectionchange with the same head after the grace
        // expires, and must not replay this move as a follow.
        lastHead = sel.head;
        lastDoc = view.state.doc;
        return;
      }
      // Anchored on the editor's own frame DOM so the caret rect lands in true
      // screen pixels wherever the canvas sits in the window. Returns null if
      // the position is stale (mid-transaction) or the DOM isn't mounted —
      // commit lastHead/lastDoc only after a successful measure so the next
      // update retries instead of silently dropping the follow. When the
      // caret sits inside a nested CodeMirror editor (code block, math
      // source), measure the native selection — PM's coordsAtPos degrades to
      // the block boundary there and would pan the canvas to the block.
      const screenRect =
        getPageFramePmScreenRectForNestedCaret(view) ??
        getPageFramePmScreenRectForPos(view, sel.head);
      if (!screenRect) {
        return;
      }
      lastHead = sel.head;
      lastDoc = view.state.doc;

      const zoom = dc.viewport.zoom;
      const screenLeft = screenRect.left;
      const screenRight = screenRect.right;
      const screenBottom = screenRect.bottom;
      const screenTop = screenRect.top;

      const margin = 120;
      const viewportLeft = margin;
      const viewportRight = window.innerWidth - margin;
      const viewportTop = margin;
      const viewportBottom = window.innerHeight - margin;

      let dx = 0;
      let dy = 0;
      if (editingElement.pageLayout === 'horizontal') {
        if (screenRight > viewportRight) {
          dx = (viewportRight - screenRight) / zoom;
        } else if (screenLeft < viewportLeft) {
          dx = (viewportLeft - screenLeft) / zoom;
        }
      } else if (screenBottom > viewportBottom) {
        dy = (viewportBottom - screenBottom) / zoom;
      } else if (screenTop < viewportTop) {
        dy = (viewportTop - screenTop) / zoom;
      }
      if (dx !== 0 || dy !== 0) {
        dc.viewport.panBy(dx, dy);
      }
    };

    const schedule = () => {
      if (pendingRaf === 0) {
        pendingRaf = requestAnimationFrame(followCursor);
      }
    };

    view.dom.addEventListener(PM_UPDATE_EVENT, schedule);
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointerup', handlePointerEnd, true);
    document.addEventListener('pointercancel', handlePointerEnd, true);

    return () => {
      if (pendingRaf !== 0) {
        cancelAnimationFrame(pendingRaf);
      }
      view.dom.removeEventListener(PM_UPDATE_EVENT, schedule);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointerup', handlePointerEnd, true);
      document.removeEventListener('pointercancel', handlePointerEnd, true);
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
          overflow: 'clip',
          zIndex: 5,
        }}
      />
      {activeView && <FloatingToolbar view={activeView} />}
      {activeView && autocompleteController && (
        <PageFrameAutocompletePopup
          controller={autocompleteController}
          view={activeView}
          onSelectItem={onAutocompleteSelect}
          showItemIcons={autocompleteKind !== 'slash'}
          enablePreview={autocompleteKind === 'note-link'}
          loadPreview={loadNoteLinkPreview}
        />
      )}
      <NoteLinkPreviewPopover
        getTargetAtPoint={getPreviewTargetAtPoint}
        loadPreview={loadNoteLinkPreview}
        suppressed={autocompleteKind !== null}
      />
      <CodeRunOverlayLayer />
    </>
  );
}
