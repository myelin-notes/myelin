import type { EditorView } from 'prosemirror-view';
import type { CanvasViewport } from '../../canvas-viewport';
import type { DrawableCanvas, Vector2 } from '../../drawable-canvas';
import type { DrawableElement } from '../../elements/drawable-element';
import { ElementType } from '../../elements/element-type';
// Constants module, not the element module: page-frame-element pulls in DrawableElement, and this
// file is reachable from it.
import { PAGE_PADDING } from '../../elements/page-frame-constants';
import type { PageFrameElement } from '../../elements/page-frame-element';
import { mapPmRectToScreen } from '../pm/screen-rect';
import {
  BAND_NODE,
  findBand,
  insertBand,
  removeBands,
  setBandHeight,
} from './band';
import { resolveBandWorldPoint } from './resolve';

/** Fraction of a page width beyond its edge where ink still reads as a margin note. */
const GUTTER_RATIO = 0.5;
/**
 * Blank band kept below the lowest ink. The next line of handwriting already has room, so the page
 * grows ahead of the pen instead of jumping every time a word is finished.
 */
const LINE_SLACK = 28;

export type AnchorMode = 'auto' | 'overlay' | 'flow';

export interface AnchorRequest {
  element: DrawableElement;
  /** Where the gesture began — decides which frame claims it. */
  origin: Vector2;
  /** World bounds of the content being anchored. */
  bounds: DOMRect;
  mode: AnchorMode;
  /** Skips the origin hit-test. Used by the explicit "add to page" action. */
  frame?: PageFrameElement;
}

interface FrameBlock {
  pos: number;
  top: number;
  bottom: number;
  bandId: string | null;
  hasContent: boolean;
}

/**
 * Binds an element to a position in a page frame's document. Returns false when nothing claims it,
 * which for ink means it stays an ordinary canvas stroke.
 */
export function anchorToPageFrame(
  canvas: DrawableCanvas,
  request: AnchorRequest,
): boolean {
  const frame = request.frame ?? findCapturingFrame(canvas, request.origin);
  const view = frame?.pmEditor?.view;
  // An unmounted frame has no layout to measure, and a band inserted against no measurement would
  // land at an arbitrary place in the document.
  if (!frame || !view || !frame.frameDiv || !frame.contentDiv) {
    return false;
  }

  const blocks = scanBlocks(frame, view, canvas.viewport);
  const joined = blocks.find(
    (block) =>
      block.bandId !== null &&
      request.origin.y >= block.top - LINE_SLACK &&
      request.origin.y <= block.bottom + LINE_SLACK,
  );
  const flow =
    request.mode === 'auto'
      ? isWhitespace(frame, blocks, request)
      : request.mode === 'flow';

  const bandId =
    joined?.bandId ??
    insertBand(view, insertPositionFor(view, blocks, request.bounds.top), 0);
  // Measured after the insert lands but before any height is set: growing a band moves what is
  // below it, never its own top, so this base stays valid.
  const bandWorld = resolveBandWorldPoint(frame, bandId, canvas.viewport);
  if (!bandWorld) {
    if (!joined) {
      removeBands(view, new Set([bandId]));
    }
    return false;
  }
  request.element.anchorToPage(frame.uuid, bandId, bandWorld);

  if (flow) {
    growBand(frame, view, bandId, request.bounds.bottom - bandWorld.y);
  }
  return true;
}

/** Sets a band's reserved height, or clears it back to a pure overlay marker with `height` <= 0. */
export function setBandReservedHeight(
  frame: PageFrameElement,
  bandId: string,
  height: number,
): void {
  const view = frame.pmEditor?.view;
  if (view) {
    setBandHeight(view, bandId, clampBandHeight(frame, height));
  }
}

export function getBandReservedHeight(
  frame: PageFrameElement,
  bandId: string,
): number {
  const view = frame.pmEditor?.view;
  const found = view ? findBand(view.state.doc, bandId) : null;
  return found ? (found.node.attrs.height as number) : 0;
}

function growBand(
  frame: PageFrameElement,
  view: EditorView,
  bandId: string,
  needed: number,
): void {
  const found = findBand(view.state.doc, bandId);
  const current = found ? (found.node.attrs.height as number) : 0;
  const height = clampBandHeight(frame, Math.max(current, needed + LINE_SLACK));
  setBandHeight(view, bandId, height);
}

// A band is unbreakable, so one taller than a page could never be laid out. Continuous frames have
// no page breaks to straddle.
function clampBandHeight(frame: PageFrameElement, height: number): number {
  const max =
    frame.pageLayout === 'continuous'
      ? Number.POSITIVE_INFINITY
      : frame.pageHeight - PAGE_PADDING * 2;
  return Math.max(0, Math.min(height, max));
}

/** The frame an element sitting at `bounds` would be embedded into, if any. */
export function findFrameForBounds(
  canvas: DrawableCanvas,
  bounds: DOMRect,
): PageFrameElement | null {
  return findCapturingFrame(canvas, {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
}

function findCapturingFrame(
  canvas: DrawableCanvas,
  origin: Vector2,
): PageFrameElement | null {
  const frames = canvas.getElementsByType(
    ElementType.PAGE_FRAME,
  ) as PageFrameElement[];
  // Back to front: the topmost frame under the pen wins.
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    // Column layout stacks pages sideways, so "the gap above the ink" has no single meaning.
    // Ink over a column frame stays ordinary canvas ink.
    if (frame.hidden || frame.pageLayout === 'horizontal') {
      continue;
    }
    const gutter = frame.pageWidth * GUTTER_RATIO;
    if (
      origin.x >= frame.offset.x - gutter &&
      origin.x <= frame.offset.x + frame.totalWidth + gutter &&
      origin.y >= frame.offset.y &&
      origin.y <= frame.offset.y + frame.totalHeight
    ) {
      return frame;
    }
  }
  return null;
}

/**
 * Ink that lands on the page's own empty space is composition and should push the document open;
 * ink laid over words, or out in the margin, is annotation and must not move anything.
 */
function isWhitespace(
  frame: PageFrameElement,
  blocks: readonly FrameBlock[],
  request: AnchorRequest,
): boolean {
  const inGutter =
    request.origin.x < frame.offset.x ||
    request.origin.x > frame.offset.x + frame.totalWidth;
  if (inGutter) {
    return false;
  }
  return !blocks.some(
    (block) =>
      block.hasContent &&
      block.bottom > request.bounds.top &&
      block.top < request.bounds.bottom,
  );
}

/** Before the first block the ink reaches into, so the band sits at the nearest gap above it. */
function insertPositionFor(
  view: EditorView,
  blocks: readonly FrameBlock[],
  inkTop: number,
): number {
  const target = blocks.find((block) => block.bottom > inkTop);
  return target ? target.pos : view.state.doc.content.size;
}

function scanBlocks(
  frame: PageFrameElement,
  view: EditorView,
  viewport: CanvasViewport,
): FrameBlock[] {
  const frameDiv = frame.frameDiv;
  const contentDiv = frame.contentDiv;
  if (!frameDiv || !contentDiv) {
    return [];
  }
  const frameRect = frameDiv.getBoundingClientRect();
  const contentRect = contentDiv.getBoundingClientRect();

  const blocks: FrameBlock[] = [];
  view.state.doc.forEach((node, pos) => {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) {
      return;
    }
    const screen = mapPmRectToScreen(
      frameRect,
      contentRect,
      dom.getBoundingClientRect(),
    );
    const isBand = node.type.name === BAND_NODE;
    blocks.push({
      pos,
      top: viewport.getPoint({ clientX: screen.left, clientY: screen.top }).y,
      bottom: viewport.getPoint({
        clientX: screen.right,
        clientY: screen.bottom,
      }).y,
      bandId: isBand ? (node.attrs.bandId as string) : null,
      hasContent:
        !isBand && (!node.isTextblock || node.textContent.trim().length > 0),
    });
  });
  return blocks;
}
