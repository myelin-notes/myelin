import { getCanvasPalette } from './canvas-theme';
import type { CanvasViewport } from './canvas-viewport';
import {
  type DrawableElement,
  drawSelectionBounds,
  getResizeHandles,
  hitResizeHandle,
  type ResizeHandle,
  ResizeHandles,
} from './elements/drawable-element';
import { PageFrameElement } from './elements/page-frame-element';
import type { Vector2 } from './geometry';

const SELECTION_HIT_MIN_PX = {
  mouse: 20,
  pen: 28,
  touch: 44,
} as const;
const SELECTION_DISPLAY_MIN_PX = 24;
const COMPACT_SELECTION_PX = 44;
const SELECTION_ANIM_SPEED = 8;
const SELECTION_MOVE_CORE_MIN_PX = {
  mouse: 12,
  pen: 16,
  touch: 24,
} as const;

function rectContainsPoint(rect: DOMRect, point: Vector2): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

export class SelectionController {
  private animatedElements: DrawableElement[] = [];
  private overlayProgress = 0;

  public constructor(
    private readonly getElements: () => readonly DrawableElement[],
  ) {}

  public get selectedElements(): DrawableElement[] {
    return this.getElements().filter((element) => element.isSelected);
  }

  public clear(): void {
    for (const element of this.getElements()) {
      element.unselect();
    }
  }

  public selectByUuid(uuids: readonly string[]): void {
    const selected = new Set(uuids);
    for (const element of this.getElements()) {
      if (selected.has(element.uuid)) {
        element.select();
      } else {
        element.unselect();
      }
    }
  }

  public selectAll(): void {
    for (const element of this.getElements()) {
      element.select();
    }
  }

  public getBounds(): DOMRect | null {
    const selected = this.selectedElements;
    if (selected.length === 0) {
      return null;
    }

    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const element of selected) {
      const box = element.boundingBox;
      left = Math.min(left, box.left);
      top = Math.min(top, box.top);
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
    }

    return new DOMRect(left, top, right - left, bottom - top);
  }

  public getScreenBounds(viewport: CanvasViewport): DOMRect | null {
    const bounds = this.getBounds();
    if (!bounds) {
      return null;
    }

    const topLeft = viewport.worldToScreen({ x: bounds.left, y: bounds.top });
    const bottomRight = viewport.worldToScreen({
      x: bounds.right,
      y: bounds.bottom,
    });

    return new DOMRect(
      Math.min(topLeft.x, bottomRight.x),
      Math.min(topLeft.y, bottomRight.y),
      Math.abs(bottomRight.x - topLeft.x),
      Math.abs(bottomRight.y - topLeft.y),
    );
  }

  public getInteractionBounds(
    zoom: number,
    pointerType: string,
  ): DOMRect | null {
    const bounds = this.getBounds();
    if (!bounds) {
      return null;
    }
    const minPx =
      SELECTION_HIT_MIN_PX[pointerType as keyof typeof SELECTION_HIT_MIN_PX] ??
      SELECTION_HIT_MIN_PX.mouse;
    const minWorld = minPx / zoom;
    return this.expandBounds(bounds, minWorld);
  }

  private getDisplayBounds(zoom: number): DOMRect | null {
    const bounds = this.getBounds();
    return bounds
      ? this.expandBounds(bounds, SELECTION_DISPLAY_MIN_PX / zoom)
      : null;
  }

  private expandBounds(bounds: DOMRect, minSize: number): DOMRect {
    const width = Math.max(bounds.width, minSize);
    const height = Math.max(bounds.height, minSize);
    return new DOMRect(
      bounds.x - (width - bounds.width) / 2,
      bounds.y - (height - bounds.height) / 2,
      width,
      height,
    );
  }

  private containsInteractionPoint(
    point: Vector2,
    zoom: number,
    pointerType: string,
  ): boolean {
    const bounds = this.getInteractionBounds(zoom, pointerType);
    return bounds !== null && rectContainsPoint(bounds, point);
  }

  private getHandles(zoom: number): ResizeHandle[] {
    const selected = this.selectedElements;
    const bounds = this.getDisplayBounds(zoom);
    return bounds
      ? getResizeHandles(bounds, this.getResizeHandleFlags(selected, zoom))
      : [];
  }

  public hitHandle(
    point: Vector2,
    zoom: number,
    pointerType: string,
  ): ResizeHandle | null {
    const selected = this.selectedElements;
    const bounds = this.getBounds();
    if (bounds) {
      const minPx =
        SELECTION_MOVE_CORE_MIN_PX[
          pointerType as keyof typeof SELECTION_MOVE_CORE_MIN_PX
        ] ?? SELECTION_MOVE_CORE_MIN_PX.mouse;
      if (rectContainsPoint(this.expandBounds(bounds, minPx / zoom), point)) {
        return null;
      }
    }
    const visualHandle = hitResizeHandle(
      this.getHandles(zoom),
      point,
      zoom,
      pointerType === 'touch',
    );
    if (!visualHandle || selected.length !== 1) {
      return visualHandle;
    }
    return (
      selected[0]
        .getHandles()
        .find(
          (handle) =>
            handle.anchorFx === visualHandle.anchorFx &&
            handle.anchorFy === visualHandle.anchorFy,
        ) ?? null
    );
  }

  public shouldUseSelectToolForTouch(point: Vector2, zoom: number): boolean {
    if (
      this.containsInteractionPoint(point, zoom, 'touch') ||
      this.hitHandle(point, zoom, 'touch')
    ) {
      return true;
    }
    return this.getElements().some(
      (element) =>
        element.grabsFromBody && rectContainsPoint(element.boundingBox, point),
    );
  }

  public get hasOverlay(): boolean {
    return this.selectedElements.some(
      (element) => !element.hidden && this.overlayProgress > 0,
    );
  }

  public advanceOverlay(deltaTime: number): void {
    const selected = this.selectedElements;
    const changed =
      selected.length !== this.animatedElements.length ||
      selected.some(
        (element, index) => element !== this.animatedElements[index],
      );
    if (changed) {
      this.animatedElements = selected;
      this.overlayProgress = 0;
    }
    if (selected.some((element) => !element.hidden)) {
      this.overlayProgress = Math.min(
        1,
        this.overlayProgress + deltaTime * SELECTION_ANIM_SPEED,
      );
    } else {
      this.overlayProgress = 0;
    }
  }

  public drawOverlay(
    ctx: CanvasRenderingContext2D,
    editingElement: DrawableElement | null,
    zoom: number,
  ): void {
    const selected = this.selectedElements;
    if (selected.length === 0) {
      return;
    }
    const visible = selected.filter((element) => !element.hidden);
    const bounds = this.getDisplayBounds(zoom);
    if (visible.length === 0 || !bounds) {
      return;
    }
    if (selected.length > 1) {
      ctx.strokeStyle = getCanvasPalette().selectionStroke;
      ctx.lineWidth = 1 / zoom;
      ctx.globalAlpha = this.overlayProgress * 0.55;
      ctx.setLineDash([]);
      for (const element of visible) {
        const box = element.boundingBox;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.width, box.height, 2 / zoom);
        ctx.stroke();
      }
    }
    drawSelectionBounds(
      ctx,
      bounds,
      this.overlayProgress,
      selected.length === 1 && selected[0] === editingElement,
      this.getResizeHandleFlags(selected, zoom),
    );
  }

  private getResizeHandleFlags(
    selected: readonly DrawableElement[],
    zoom: number,
  ): ResizeHandles {
    if (selected.length !== 1) {
      return ResizeHandles.Corners;
    }
    const flags = selected[0].resizeHandles;
    const bounds = this.getBounds();
    if (
      bounds &&
      (bounds.width * zoom < COMPACT_SELECTION_PX ||
        bounds.height * zoom < COMPACT_SELECTION_PX) &&
      (flags & ResizeHandles.Corners) !== 0
    ) {
      return flags & ResizeHandles.Corners;
    }
    return flags;
  }

  public findPageFrameByName(displayName: string): PageFrameElement | null {
    return (
      this.getElements().find(
        (element): element is PageFrameElement =>
          element instanceof PageFrameElement &&
          element.displayName === displayName,
      ) ?? null
    );
  }

  public findPageFrameById(uuid: string): PageFrameElement | null {
    return (
      this.getElements().find(
        (element): element is PageFrameElement =>
          element instanceof PageFrameElement && element.uuid === uuid,
      ) ?? null
    );
  }
}
