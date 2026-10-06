import { Anchor, Rows3, Unlink } from 'lucide-react';
import type { DrawableCanvas } from '../drawable-canvas';
import { AnchorableElement } from '../elements/anchorable-element';
import type {
  DrawableElement,
  SelectionToolbarItem,
} from '../elements/drawable-element';
import {
  PAGE_GAP,
  PAGE_PADDING,
  PageFrameElement,
} from '../elements/page-frame-element';
import type { StrokeElement } from '../elements/stroke-element';
import type { Vector2 } from '../geometry';
import type { Messages } from '../i18n/messages';
import {
  type AnchorGap,
  encodeAnchorPosition,
  resolveAnchorPosition,
  setAnchorGaps,
} from './pm/anchoring';

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

  public findFrame(point: Vector2): PageFrameElement | null {
    return (
      [...this.canvas.elements]
        .reverse()
        .find(
          (element): element is PageFrameElement =>
            element instanceof PageFrameElement &&
            !element.hidden &&
            pageContainsPoint(element, point),
        ) ?? null
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
    frame: PageFrameElement,
    point = this.pointOnElement(element),
  ): boolean {
    const view = frame.pmEditor?.view;
    const content = frame.contentDiv;
    if (!view || !content) {
      return false;
    }
    const bounds = content.getBoundingClientRect();
    if (!content.offsetWidth || !bounds.width) {
      return false;
    }
    const scale = bounds.width / content.offsetWidth;
    const box = element.boundingBox;
    const coords = {
      left: bounds.left + ((point.x - frame.offset.x) / frame.scale.x) * scale,
      top:
        bounds.top +
        (((element.makesSpace ? box.top : point.y) - frame.offset.y) /
          frame.scale.y) *
          scale,
    };
    if (element.makesSpace) {
      const localX = (point.x - frame.offset.x) / frame.scale.x;
      const column =
        frame.pageLayout === 'horizontal'
          ? Math.max(0, Math.floor(localX / (frame.pageWidth + PAGE_GAP)))
          : 0;
      coords.left =
        bounds.left +
        (column * (frame.pageWidth + PAGE_GAP) + PAGE_PADDING) * scale;
    }
    const pos = view.posAtCoords(coords)?.pos ?? view.state.doc.content.size;
    return this.attachAtPosition(element, frame, pos);
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
    // Gaps inside tables, lists, and source editors would reserve only a cell or nested block.
    if (
      element.makesSpace &&
      (resolved.depth > 1 ||
        !resolved.parent.isTextblock ||
        ['codeBlock', 'mathBlock'].includes(resolved.parent.type.name))
    ) {
      pos = resolved.depth > 0 ? resolved.before(1) : pos;
    }
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
    const box = element.boundingBox;
    const offset = element.offset;
    this.origins.set(element.uuid, origin);
    element.anchorOrigin = () => this.worldOrigin(element, frame);
    element.setPageAnchor({
      frameId: frame.uuid,
      spaceBefore: 0,
      position: encodeAnchorPosition(view.state, pos),
      blockPosition: encodeAnchorPosition(
        view.state,
        resolved.depth > 0 ? resolved.before(1) : pos,
      ),
      x: offset.x - frame.offset.x - origin.x * frame.scale.x,
      y: element.makesSpace
        ? offset.y - box.top
        : offset.y - frame.offset.y - origin.y * frame.scale.y,
    });
    this.refresh();
    if (element.makesSpace) {
      const gapTop = this.worldOrigin(element, frame)?.y ?? offset.y;
      element.setOffset(
        offset.x,
        Math.max(
          offset.y,
          gapTop - element.localBoundingBox.top * element.scale.y,
        ),
      );
      element.setPageAnchor({
        ...element.pageAnchor!,
        spaceBefore: Math.max(
          0,
          (element.pageAnchor!.y +
            element.localBoundingBox.top * element.scale.y) /
            frame.scale.y,
        ),
      });
      this.refresh();
    }
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

  public finishTransform(elements: readonly DrawableElement[]): void {
    const moved = new Set(elements.map((element) => element.uuid));
    this.canvas.transact(() => {
      for (const element of elements) {
        if (
          !(element instanceof AnchorableElement) ||
          !element.pageAnchor ||
          moved.has(element.pageAnchor.frameId)
        ) {
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
        (element) => element.pageAnchor!.frameId === frame.uuid,
      );
      const positions = new Map(
        children.map((element) => [
          element.uuid,
          resolveAnchorPosition(
            view.state,
            element.pageAnchor!.position,
            element.pageAnchor!.blockPosition,
          ),
        ]),
      );
      const gaps = new Map<string, AnchorGap>();
      for (const element of children) {
        if (!element.makesSpace) {
          continue;
        }
        const anchor = element.pageAnchor!;
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
              ...element.pageAnchor!,
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
          widgets.get(element.pageAnchor!.sharedGap?.id ?? element.uuid),
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
        element.anchorOrigin = () => this.worldOrigin(element, frame);
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
    const frame = [...this.canvas.elements]
      .reverse()
      .find(
        (candidate): candidate is PageFrameElement =>
          candidate instanceof PageFrameElement &&
          !candidate.hidden &&
          overlapPoint(candidate, element) !== null,
      );
    const labels = strings.canvas.selectionToolbar;
    return [
      {
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
            } else if (frame) {
              this.attach(element, frame, overlapPoint(frame, element)!);
            }
          }),
      },
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
