import type { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import { PageFrameElement } from './elements/page-frame-element';

export class SelectionController {
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
