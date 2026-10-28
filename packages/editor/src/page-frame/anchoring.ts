import { Anchor, Rows3, Unlink } from 'lucide-react';
import type { DrawableCanvas } from '../drawable-canvas';
import {
  AnchorableElement,
  type PageFrameAnchor,
} from '../elements/anchorable-element';
import { BookmarkElement } from '../elements/bookmark-element';
import type {
  DrawableElement,
  SelectionToolbarItem,
} from '../elements/drawable-element';
import {
  PAGE_GAP,
  PAGE_PADDING,
  PageFrameElement,
} from '../elements/page-frame-element';
import { PdfElement } from '../elements/pdf';
import type { StrokeElement } from '../elements/stroke-element';
import type { Vector2 } from '../geometry';
import type { Messages } from '../i18n/messages';
import {
  type AnchorGap,
  encodeAnchorPosition,
  resolveAnchorPosition,
  setAnchorGaps,
} from './pm/anchoring';

type AnchorTarget = PageFrameElement | PdfElement;

function frameAnchor(element: AnchorableElement): PageFrameAnchor | null {
  const anchor = element.pageAnchor;
  return anchor?.kind === 'pdf' ? null : anchor;
}

export interface PageFramePasteTarget {
  frameId: string;
  position: number[];
  blockPosition: number[];
}

function pageBounds(frame: PageFrameElement): DOMRect[] {
  return Array.from(
    { length: frame.pageLayout === 'continuous' ? 1 : frame.numPages },
    (_, page) =>
      new DOMRect(
        frame.offset.x +
          (frame.pageLayout === 'horizontal'
            ? page * (frame.pageWidth + PAGE_GAP) * frame.scale.x
            : 0),
        frame.offset.y +
          (frame.pageLayout === 'vertical'
            ? page * (frame.pageHeight + PAGE_GAP) * frame.scale.y
            : 0),
        frame.pageWidth * frame.scale.x,
        (frame.pageLayout === 'continuous'
          ? frame.totalHeight
          : frame.pageHeight) * frame.scale.y,
      ),
  );
}

export function pageContainsPoint(
  frame: PageFrameElement,
  point: Vector2,
): boolean {
  return pageBounds(frame).some(
    (box) =>
      point.x >= box.left &&
      point.x <= box.right &&
      point.y >= box.top &&
      point.y <= box.bottom,
  );
}

function overlapPoint(
  frame: PageFrameElement,
  element: DrawableElement,
): Vector2 | null {
  const box = element.boundingBox;
  for (const page of pageBounds(frame)) {
    const left = Math.max(page.left, box.left);
    const right = Math.min(page.right, box.right);
    const top = Math.max(page.top, box.top);
    const bottom = Math.min(page.bottom, box.bottom);
    if (left <= right && top <= bottom) {
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
  }
  return null;
}

export class PageFrameAnchoring {
  private origins = new Map<string, Vector2>();
  // Render from their base offset so they stay under the pointer while their gaps reflow the text.
  private dragging = new Set<AnchorableElement>();

  public constructor(
    private readonly canvas: DrawableCanvas,
    private readonly onLayoutChange: () => void = () => {},
  ) {}

  private frameFor(element: AnchorableElement): PageFrameElement | null {
    const frame = this.canvas.elements.find(
      (frame) => frame.uuid === element.pageAnchor?.frameId,
    );
    return frame instanceof PageFrameElement ? frame : null;
  }

  private pdfFor(element: AnchorableElement): PdfElement | null {
    const pdf = this.canvas.elements.find(
      (pdf) => pdf.uuid === element.pageAnchor?.frameId,
    );
    return pdf instanceof PdfElement ? pdf : null;
  }

  // A page under the point wins over a PDF whose margin band holds it.
  public findFrame(point: Vector2): AnchorTarget | null {
    return (
      [...this.canvas.elements]
        .reverse()
        .find(
          (element): element is AnchorTarget =>
            !element.hidden &&
            ((element instanceof PageFrameElement &&
              pageContainsPoint(element, point)) ||
              (element instanceof PdfElement &&
                element.findPageAt(point, false) >= 0)),
        ) ??
      this.findPdfBand(point) ??
      null
    );
  }

  private findPdfBand(point: Vector2): PdfElement | undefined {
    return [...this.canvas.elements]
      .reverse()
      .find(
        (element): element is PdfElement =>
          element instanceof PdfElement &&
          !element.hidden &&
          element.findPageAt(point, true) >= 0,
      );
  }

  private pointOnElement(element: DrawableElement): Vector2 {
    const box = element.boundingBox;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  private localRect(
    frame: PageFrameElement,
    rect: { left: number; top: number },
  ): Vector2 | null {
    const content = frame.contentDiv;
    if (!content) {
      return null;
    }
    const bounds = content.getBoundingClientRect();
    if (!bounds.width || !content.offsetWidth) {
      return null;
    }
    const scale = content.offsetWidth / bounds.width;
    return {
      x: (rect.left - bounds.left) * scale,
      y: (rect.top - bounds.top) * scale,
    };
  }

  private origin(
    frame: PageFrameElement,
    pos: number,
    gap?: HTMLElement,
  ): Vector2 | null {
    const view = frame.pmEditor?.view;
    if (!view) {
      return null;
    }
    const local = this.localRect(
      frame,
      gap ? gap.getBoundingClientRect() : view.coordsAtPos(pos),
    );
    if (!local) {
      return null;
    }
    return {
      x:
        frame.pageLayout === 'horizontal'
          ? Math.max(0, Math.floor(local.x / (frame.pageWidth + PAGE_GAP))) *
            (frame.pageWidth + PAGE_GAP)
          : 0,
      y: local.y,
    };
  }

  public attach(
    element: AnchorableElement,
    frame: AnchorTarget,
    point = this.pointOnElement(element),
  ): boolean {
    if (frame instanceof PdfElement) {
      return this.attachToPdf(element, frame, point);
    }
    const pos = this.textPositionAt(
      frame,
      element.makesSpace ? { x: point.x, y: element.boundingBox.top } : point,
      element,
    );
    return pos !== null && this.attachAtPosition(element, frame, pos);
  }

  /**
   * The frame's text position at the world `point`, held inside its page's text column; `null` while
   * the editor isn't laid out. A space-making `element` snaps to the column start, past its own gap.
   */
  public textPositionAt(
    frame: PageFrameElement,
    point: Vector2,
    element?: AnchorableElement,
  ): number | null {
    const view = frame.pmEditor?.view;
    const content = frame.contentDiv;
    if (!view || !content) {
      return null;
    }
    const bounds = content.getBoundingClientRect();
    if (!content.offsetWidth || !bounds.width) {
      return null;
    }
    const scale = bounds.width / content.offsetWidth;
    const localX = (point.x - frame.offset.x) / frame.scale.x;
    const column =
      frame.pageLayout === 'horizontal'
        ? Math.max(0, Math.floor(localX / (frame.pageWidth + PAGE_GAP)))
        : 0;
    const left =
      bounds.left +
      (column * (frame.pageWidth + PAGE_GAP) + PAGE_PADDING) * scale;
    const right = left + (frame.pageWidth - PAGE_PADDING * 2) * scale - 1;
    const coords = {
      left: element?.makesSpace
        ? left
        : Math.min(Math.max(bounds.left + localX * scale, left), right),
      top: bounds.top + ((point.y - frame.offset.y) / frame.scale.y) * scale,
    };
    const anchor = element && frameAnchor(element);
    const ownGap =
      element?.makesSpace && anchor?.frameId === frame.uuid && !anchor.sharedGap
        ? Array.from(
            view.dom.querySelectorAll<HTMLElement>('[data-page-anchor]'),
          )
            .find((dom) => dom.dataset.pageAnchor === element.uuid)
            ?.getBoundingClientRect()
        : undefined;
    // Probe the layout without the element's own gap; otherwise a drop below it lands a gap-height early.
    if (
      ownGap &&
      coords.top >= ownGap.top &&
      ownGap.left <= coords.left + 1 &&
      coords.left < ownGap.right
    ) {
      coords.top += ownGap.height;
    }
    // posAtCoords is null outside the editor box, which anchors to the end of the document — right
    // below the content, wrong above it.
    coords.top = Math.max(coords.top, view.dom.getBoundingClientRect().top);
    return view.posAtCoords(coords)?.pos ?? view.state.doc.content.size;
  }

  public attachAtPosition(
    element: AnchorableElement,
    frame: PageFrameElement,
    position: number,
    placeAtCursor = false,
  ): boolean {
    const view = frame.pmEditor?.view;
    if (!view) {
      return false;
    }
    let pos = position;
    const resolved = view.state.doc.resolve(pos);
    const isSource = (name: string) =>
      name === 'codeBlock' || name === 'mathBlock';
    // Gaps inside tables, lists, and source editors would reserve only a cell or nested block.
    if (
      element.makesSpace &&
      (resolved.depth > 1 ||
        !resolved.parent.isTextblock ||
        isSource(resolved.parent.type.name))
    ) {
      pos = resolved.depth > 0 ? resolved.before(1) : pos;
    } else if (
      element.makesSpace &&
      resolved.parentOffset === resolved.parent.content.size
    ) {
      // A widget ending a textblock gets ProseMirror's trailing <br>: a blank line under the gap.
      pos = resolved.after(1);
    }
    // Between blocks a gap shares the next block's position, so pagination can only break above the
    // gap; inside the next paragraph it can break between the gap and the text.
    const next = element.makesSpace
      ? view.state.doc.resolve(pos).nodeAfter
      : null;
    if (next?.isTextblock && !isSource(next.type.name)) {
      pos += 1;
    }
    const block = view.state.doc.resolve(pos);
    const origin = this.origin(frame, pos);
    if (!origin) {
      return false;
    }
    if (placeAtCursor) {
      element.setOffset(
        frame.offset.x + (origin.x + PAGE_PADDING) * frame.scale.x,
        frame.offset.y + origin.y * frame.scale.y,
      );
    }
    const offset = element.offset;
    const pinned = this.dragging.has(element);
    this.origins.set(element.uuid, origin);
    if (!pinned) {
      element.anchorOrigin = () => this.worldOrigin(element, frame);
    }
    element.setPageAnchor({
      frameId: frame.uuid,
      spaceBefore: 0,
      position: encodeAnchorPosition(view.state, pos),
      blockPosition: encodeAnchorPosition(
        view.state,
        block.depth > 0 ? block.before(1) : pos,
      ),
      x: offset.x - frame.offset.x - origin.x * frame.scale.x,
      y: offset.y - frame.offset.y - origin.y * frame.scale.y,
    });
    this.refresh();
    if (element.makesSpace) {
      const gapTop = this.worldOrigin(element, frame)?.y ?? offset.y;
      element.setPageAnchor({ ...frameAnchor(element)!, y: offset.y - gapTop });
      // Text above the gap pushes the element down only once it is dropped.
      if (!pinned) {
        element.setOffset(
          offset.x,
          Math.max(
            offset.y,
            gapTop - element.localBoundingBox.top * element.scale.y,
          ),
        );
      }
      const anchor = frameAnchor(element)!;
      element.setPageAnchor({
        ...anchor,
        spaceBefore: Math.max(
          0,
          (anchor.y + element.localBoundingBox.top * element.scale.y) /
            frame.scale.y,
        ),
      });
      this.refresh();
    }
    return true;
  }

  private attachToPdf(
    element: AnchorableElement,
    pdf: PdfElement,
    point: Vector2,
  ): boolean {
    const position = pdf.findPageAt(point, true);
    const page = position < 0 ? null : pdf.getAnchorPageKey(position);
    const origin = page === null ? null : pdf.getPageOrigin(page);
    if (page === null || !origin) {
      return false;
    }
    const offset = { ...element.offset };
    const scale = { ...element.scale };
    element.anchorOrigin = () => pdf.getAnchorOrigin(element.pageAnchor);
    element.setPageAnchor({
      kind: 'pdf',
      frameId: pdf.uuid,
      page,
      x: (offset.x - origin.x) / origin.scale.x,
      y: (offset.y - origin.y) / origin.scale.y,
      scaleX: scale.x / origin.scale.x,
      scaleY: scale.y / origin.scale.y,
    });
    return true;
  }

  private worldOrigin(
    element: AnchorableElement,
    frame: PageFrameElement,
  ): Vector2 | null {
    const origin = this.origins.get(element.uuid);
    return origin
      ? {
          x: frame.offset.x + origin.x * frame.scale.x,
          y: frame.offset.y + origin.y * frame.scale.y,
        }
      : null;
  }

  public autoAnchorStroke(stroke: StrokeElement): void {
    const points = stroke.xyPoints;
    if (!points.length) {
      return;
    }
    for (const point of [points[0], points[points.length - 1]]) {
      const world = {
        x: point[0] * stroke.scale.x + stroke.offset.x,
        y: point[1] * stroke.scale.y + stroke.offset.y,
      };
      const frame = this.findFrame(world);
      if (frame) {
        this.attach(stroke, frame, world);
        return;
      }
    }
  }

  private movedWithoutFrame(
    elements: readonly DrawableElement[],
  ): AnchorableElement[] {
    const moved = new Set(elements.map((element) => element.uuid));
    return elements.filter(
      (element): element is AnchorableElement =>
        element instanceof AnchorableElement &&
        !!element.pageAnchor &&
        !moved.has(element.pageAnchor.frameId),
    );
  }

  /** Re-anchors space-making elements on every move so text reflows live. `endDrag` must follow. */
  public dragTransform(elements: readonly DrawableElement[]): void {
    this.canvas.transact(() => {
      for (const element of this.movedWithoutFrame(elements)) {
        // PDF pages don't reflow, so there's nothing to pin against; a null origin would also drop the
        // PDF anchor's scale.
        if (element.pageAnchor?.kind === 'pdf') {
          continue;
        }
        if (!this.dragging.has(element)) {
          // Syncs the base offset the pinned element renders from.
          element.setOffset(element.offset.x, element.offset.y);
          element.anchorOrigin = null;
          this.dragging.add(element);
        }
        const frame = this.frameFor(element);
        const point = frame && overlapPoint(frame, element);
        if (element.makesSpace && frame && point) {
          this.attach(element, frame, point);
        }
      }
    });
  }

  /** Releases elements pinned by `dragTransform` back to their anchors without re-anchoring them. */
  public endDrag(): void {
    this.dragging.clear();
    this.refresh();
  }

  public finishTransform(elements: readonly DrawableElement[]): void {
    this.canvas.transact(() => {
      for (const element of this.movedWithoutFrame(elements)) {
        // Still renders from the dropped position until attach rebinds its origin.
        this.dragging.delete(element);
        if (element.pageAnchor?.kind === 'pdf') {
          const pdf = this.pdfFor(element);
          if (
            !pdf ||
            !this.attachToPdf(element, pdf, this.pointOnElement(element))
          ) {
            element.setPageAnchor(null);
          }
          continue;
        }
        const frame = this.frameFor(element);
        const point = frame && overlapPoint(frame, element);
        if (!frame || !point) {
          element.setPageAnchor(null);
        } else {
          this.attach(element, frame, point);
        }
      }
    });
  }

  public refresh(): void {
    let changed = false;
    const anchored = this.canvas.elements.filter(
      (element): element is AnchorableElement =>
        element instanceof AnchorableElement && element.pageAnchor !== null,
    );
    const activeIds = new Set(anchored.map((element) => element.uuid));
    for (const id of this.origins.keys()) {
      if (!activeIds.has(id)) {
        this.origins.delete(id);
      }
    }
    for (const frame of this.canvas.elements) {
      if (!(frame instanceof PageFrameElement) || !frame.pmEditor?.view) {
        continue;
      }
      const view = frame.pmEditor.view;
      const children = anchored.filter(
        (element) => frameAnchor(element)?.frameId === frame.uuid,
      );
      const positions = new Map(
        children.map((element) => [
          element.uuid,
          resolveAnchorPosition(
            view.state,
            frameAnchor(element)!.position,
            frameAnchor(element)!.blockPosition,
          ),
        ]),
      );
      const gaps = new Map<string, AnchorGap>();
      for (const element of children) {
        if (!element.makesSpace) {
          continue;
        }
        const anchor = frameAnchor(element)!;
        const id = anchor.sharedGap?.id ?? element.uuid;
        gaps.set(id, {
          id,
          pos: positions.get(element.uuid)!,
          height:
            anchor.sharedGap?.height ??
            element.boundingBox.height / frame.scale.y + anchor.spaceBefore,
        });
      }
      const previousEnd = view.state.doc.content.size;
      if (setAnchorGaps(view, [...gaps.values()], positions.values())) {
        for (const element of children) {
          const pos = positions.get(element.uuid)!;
          if (pos >= previousEnd - 1) {
            const resolved = view.state.doc.resolve(pos);
            element.setPageAnchor({
              ...frameAnchor(element)!,
              position: encodeAnchorPosition(view.state, pos),
              blockPosition: encodeAnchorPosition(
                view.state,
                resolved.depth > 0 ? resolved.before(1) : pos,
              ),
            });
          }
        }
      }
      const widgets = new Map(
        Array.from(
          view.dom.querySelectorAll<HTMLElement>('[data-page-anchor]'),
          (dom) => [dom.dataset.pageAnchor!, dom],
        ),
      );
      for (const element of children) {
        const origin = this.origin(
          frame,
          positions.get(element.uuid)!,
          widgets.get(frameAnchor(element)!.sharedGap?.id ?? element.uuid),
        );
        if (origin) {
          const previous = this.origins.get(element.uuid);
          if (
            !previous ||
            Math.abs(previous.x - origin.x) > 0.01 ||
            Math.abs(previous.y - origin.y) > 0.01
          ) {
            this.origins.set(element.uuid, origin);
            changed = true;
          }
        }
        if (!this.dragging.has(element)) {
          element.anchorOrigin = () => this.worldOrigin(element, frame);
        }
      }
    }
    const pdfs = new Map(
      this.canvas.elements.flatMap((pdf) =>
        pdf instanceof PdfElement ? [[pdf.uuid, pdf] as const] : [],
      ),
    );
    for (const element of anchored) {
      const anchor = element.pageAnchor!;
      const pdf = anchor.kind === 'pdf' ? pdfs.get(anchor.frameId) : undefined;
      if (pdf) {
        element.anchorOrigin = () => pdf.getAnchorOrigin(element.pageAnchor);
      }
    }
    if (changed) {
      this.onLayoutChange();
    }
  }

  public toolbarItems(
    element: DrawableElement,
    strings: Messages,
  ): SelectionToolbarItem[] {
    if (!(element instanceof AnchorableElement)) {
      return [];
    }
    const frame =
      [...this.canvas.elements]
        .reverse()
        .find(
          (candidate): candidate is PageFrameElement =>
            candidate instanceof PageFrameElement &&
            !candidate.hidden &&
            overlapPoint(candidate, element) !== null,
        ) ?? this.findPdfBand(this.pointOnElement(element));
    const labels = strings.canvas.selectionToolbar;
    const anchorItem: SelectionToolbarItem = {
      id: 'page-anchor',
      label: element.pageAnchor ? labels.unanchor : labels.anchor,
      icon: element.pageAnchor ? Unlink : Anchor,
      active: !!element.pageAnchor,
      disabled: element.locked || (!element.pageAnchor && !frame),
      onClick: () =>
        this.canvas.transact(() => {
          if (element.pageAnchor) {
            element.setPageAnchor(null);
            this.refresh();
          } else if (frame instanceof PdfElement) {
            this.attach(element, frame);
          } else if (frame) {
            this.attach(element, frame, overlapPoint(frame, element)!);
          }
        }),
    };
    // PDF pages don't reflow, so there is no space to make; a flag is a point marker.
    if (
      element instanceof BookmarkElement ||
      (element.pageAnchor
        ? element.pageAnchor.kind === 'pdf'
        : frame instanceof PdfElement)
    ) {
      return [anchorItem];
    }
    return [
      anchorItem,
      {
        id: 'anchor-space',
        label: labels.makeSpace,
        icon: Rows3,
        active: element.makesSpace,
        disabled: element.locked || !element.pageAnchor,
        onClick: () =>
          this.canvas.transact(() => {
            const parent = this.frameFor(element);
            const point = this.pointOnElement(element);
            const offset = { ...element.offset };
            element.setMakesSpace(!element.makesSpace);
            if (parent) {
              this.attach(element, parent, point);
            }
            if (!element.makesSpace) {
              element.setOffset(offset.x, offset.y);
            }
          }),
      },
    ];
  }
}
