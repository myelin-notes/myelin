import {
  BoxSelect as BoxSelectIcon,
  Lasso as LassoIcon,
  MousePointer2 as PointerIcon,
} from 'lucide-react';
import { CollisionHelper } from '../../../lib/utils/collision-helper';
import { MoveElementsCommand } from '../commands/move-elements';
import { ScaleElementCommand } from '../commands/scale-element';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { PageFrameElement } from '../elements/page-frame-element';
import type { ITool, SvgIcon, ToolOption } from './tool';

const HANDLE_HIT_RADIUS = 10;
const MIN_SCALE = 0.05;

enum SelectMode {
  None,
  Moving,
  Scaling,
  Marquee,
  Lasso,
}

export class SelectTool implements ITool {
  private mode: SelectMode = SelectMode.None;
  private startPoint: Vector2 = { x: 0, y: 0 };
  private selectionStyle: 'rectangle' | 'lasso' = 'rectangle';

  // Move state
  private lastPoint: Vector2 = { x: 0, y: 0 };
  private totalDelta: Vector2 = { x: 0, y: 0 };
  private movingElements: DrawableElement[] = [];

  // Cycle-through state
  private lastCycledElement: DrawableElement | null = null;

  // Scale state
  private scalingElement: DrawableElement | null = null;
  private handleIndex: number = -1;
  private anchorWorld: Vector2 = { x: 0, y: 0 };
  private originalScale: Vector2 = { x: 1, y: 1 };
  private originalOffset: Vector2 = { x: 0, y: 0 };
  private originalDraggedWorld: Vector2 = { x: 0, y: 0 };

  // Lasso state
  private lassoPath: Vector2[] = [];

  // Double-click state
  private lastClickTime: number = 0;
  private lastClickPos: Vector2 = { x: 0, y: 0 };

  public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
    if (this.mode === SelectMode.Marquee) {
      const x = Math.min(this.startPoint.x, position.x);
      const y = Math.min(this.startPoint.y, position.y);
      const w = Math.abs(position.x - this.startPoint.x);
      const h = Math.abs(position.y - this.startPoint.y);

      ctx.fillStyle = 'rgba(208, 225, 251, 0.15)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();

      ctx.strokeStyle = '#2f3e46';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (this.mode === SelectMode.Lasso && this.lassoPath.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.lassoPath[0].x, this.lassoPath[0].y);
      for (let i = 1; i < this.lassoPath.length; i++) {
        ctx.lineTo(this.lassoPath[i].x, this.lassoPath[i].y);
      }
      ctx.lineTo(position.x, position.y);
      ctx.closePath();

      ctx.fillStyle = 'rgba(208, 225, 251, 0.15)';
      ctx.fill();

      ctx.strokeStyle = '#2f3e46';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  public start(canvas: DrawableCanvas, event: PointerEvent): void {
    const point = canvas.getPoint(event);
    this.startPoint = point;

    // 1. Check handles on selected elements first
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (!e.isSelected) {
        continue;
      }
      const handleIdx = this.hitHandle(e, point, canvas.zoom);
      if (handleIdx >= 0) {
        this.mode = SelectMode.Scaling;
        this.scalingElement = e;
        this.handleIndex = handleIdx;
        this.originalScale = { ...e.scale };
        this.originalOffset = { ...e.offset };

        const handles = e.getHandles();
        const anchorIdx = 3 - handleIdx;
        this.anchorWorld = handles[anchorIdx];
        this.originalDraggedWorld = handles[handleIdx];
        return;
      }
    }

    // 2. Double-click detection for page frame editing
    const now = Date.now();
    const dx = point.x - this.lastClickPos.x;
    const dy = point.y - this.lastClickPos.y;
    const isDoubleClick =
      now - this.lastClickTime < 400 && dx * dx + dy * dy < 25;

    if (isDoubleClick) {
      for (let i = canvas.elements.length - 1; i >= 0; i--) {
        const e = canvas.elements[i];
        if (
          e instanceof PageFrameElement &&
          CollisionHelper.inBox(point, e.boundingBox)
        ) {
          for (const el of canvas.elements) {
            el.unselect();
          }
          canvas.enterPageFrameEdit(e);
          this.lastClickTime = 0;
          return;
        }
      }
    }

    // 3. Hit-test elements (topmost first), cycle on repeated clicks
    const hits: DrawableElement[] = [];
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (CollisionHelper.inBox(point, e.boundingBox)) {
        hits.push(e);
      }
    }

    if (hits.length > 0) {
      let pick = hits[0];
      if (
        hits.length > 1 &&
        this.lastCycledElement &&
        hits.includes(this.lastCycledElement)
      ) {
        const idx = hits.indexOf(this.lastCycledElement);
        pick = hits[(idx + 1) % hits.length];
      }
      this.lastCycledElement = pick;

      for (const e of canvas.elements) {
        e.unselect();
      }
      pick.select();
      this.mode = SelectMode.Moving;
      this.lastPoint = point;
      this.totalDelta = { x: 0, y: 0 };
      this.movingElements = canvas.elements.filter((e) => e.isSelected);
      return;
    }

    // 3. Empty space → marquee or lasso
    this.lastCycledElement = null;
    if (this.selectionStyle === 'lasso') {
      this.mode = SelectMode.Lasso;
      this.lassoPath = [point];
    } else {
      this.mode = SelectMode.Marquee;
    }
    for (const e of canvas.elements) {
      e.unselect();
    }
  }

  public update(
    canvas: DrawableCanvas,
    _event: PointerEvent,
    position: Vector2,
  ): void {
    switch (this.mode) {
      case SelectMode.Moving: {
        const dx = position.x - this.lastPoint.x;
        const dy = position.y - this.lastPoint.y;
        this.totalDelta.x += dx;
        this.totalDelta.y += dy;
        for (const e of this.movingElements) {
          e.translate(dx, dy);
        }
        this.lastPoint = position;
        break;
      }
      case SelectMode.Scaling: {
        if (!this.scalingElement) {
          break;
        }
        const e = this.scalingElement;
        const localBox = e.localBoundingBox;
        if (localBox.width === 0 || localBox.height === 0) {
          break;
        }

        const origDist = {
          x: this.originalDraggedWorld.x - this.anchorWorld.x,
          y: this.originalDraggedWorld.y - this.anchorWorld.y,
        };
        const curDist = {
          x: position.x - this.anchorWorld.x,
          y: position.y - this.anchorWorld.y,
        };

        let ratioX = origDist.x !== 0 ? curDist.x / origDist.x : 1;
        let ratioY = origDist.y !== 0 ? curDist.y / origDist.y : 1;

        if (_event.shiftKey) {
          const uniform = Math.abs(ratioX) > Math.abs(ratioY) ? ratioX : ratioY;
          ratioX = uniform;
          ratioY = uniform;
        }

        const newScale = {
          x: Math.max(MIN_SCALE, this.originalScale.x * ratioX),
          y: Math.max(MIN_SCALE, this.originalScale.y * ratioY),
        };

        // Compute anchor in local space to keep it fixed
        const anchorLocal = {
          x:
            (this.anchorWorld.x - this.originalOffset.x) / this.originalScale.x,
          y:
            (this.anchorWorld.y - this.originalOffset.y) / this.originalScale.y,
        };
        const newOffset = {
          x: this.anchorWorld.x - anchorLocal.x * newScale.x,
          y: this.anchorWorld.y - anchorLocal.y * newScale.y,
        };

        e.setScale(newScale.x, newScale.y);
        e.setOffset(newOffset.x, newOffset.y);
        break;
      }
      case SelectMode.Marquee: {
        const marqueeRect = new DOMRect(
          Math.min(this.startPoint.x, position.x),
          Math.min(this.startPoint.y, position.y),
          Math.abs(position.x - this.startPoint.x),
          Math.abs(position.y - this.startPoint.y),
        );
        for (const e of canvas.elements) {
          const box = e.boundingBox;
          if (
            CollisionHelper.overlappingAreaOf2Rect(marqueeRect, box) >
            box.width * box.height * 0.5
          ) {
            e.select();
          } else {
            e.unselect();
          }
        }
        break;
      }
      case SelectMode.Lasso: {
        this.lassoPath.push(position);
        const poly = [...this.lassoPath, position];
        for (const e of canvas.elements) {
          const box = e.boundingBox;
          const center: Vector2 = {
            x: box.x + box.width * 0.5,
            y: box.y + box.height * 0.5,
          };
          if (CollisionHelper.isPointInPolygon(center, poly)) {
            e.select();
          } else {
            e.unselect();
          }
        }
        break;
      }
    }
  }

  public finish(canvas: DrawableCanvas, _event: PointerEvent): void {
    switch (this.mode) {
      case SelectMode.Moving: {
        if (this.totalDelta.x !== 0 || this.totalDelta.y !== 0) {
          canvas.pushApplied(
            new MoveElementsCommand(
              [...this.movingElements],
              this.totalDelta.x,
              this.totalDelta.y,
            ),
          );
        }
        break;
      }
      case SelectMode.Scaling: {
        if (this.scalingElement) {
          const e = this.scalingElement;
          if (
            e.scale.x !== this.originalScale.x ||
            e.scale.y !== this.originalScale.y ||
            e.offset.x !== this.originalOffset.x ||
            e.offset.y !== this.originalOffset.y
          ) {
            canvas.pushApplied(
              new ScaleElementCommand(
                e,
                { ...this.originalScale },
                { ...this.originalOffset },
                { ...e.scale },
                { ...e.offset },
              ),
            );
          }
        }
        break;
      }
    }

    canvas.updateBounding();
    this.lastClickTime = Date.now();
    this.lastClickPos = { ...this.startPoint };
    this.reset();
  }

  public interrupt(_canvas: DrawableCanvas): void {
    if (this.mode === SelectMode.Moving) {
      for (const e of this.movingElements) {
        e.translate(-this.totalDelta.x, -this.totalDelta.y);
      }
    }
    if (this.mode === SelectMode.Scaling && this.scalingElement) {
      this.scalingElement.setScale(this.originalScale.x, this.originalScale.y);
      this.scalingElement.setOffset(
        this.originalOffset.x,
        this.originalOffset.y,
      );
    }
    this.lastCycledElement = null;
    this.reset();
  }

  public hover(canvas: DrawableCanvas, position: Vector2): void {
    if (this.mode === SelectMode.Moving) {
      canvas.setCursor('move');
      return;
    }
    if (this.mode === SelectMode.Scaling) {
      canvas.setCursor(SelectTool.resizeCursor(this.handleIndex));
      return;
    }

    // Idle — check handles on selected elements
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (!e.isSelected) {
        continue;
      }
      const handleIdx = this.hitHandle(e, position, canvas.zoom);
      if (handleIdx >= 0) {
        canvas.setCursor(SelectTool.resizeCursor(handleIdx));
        return;
      }
    }

    // Check selected element bodies
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (e.isSelected && CollisionHelper.inBox(position, e.boundingBox)) {
        canvas.setCursor('move');
        return;
      }
    }

    canvas.setCursor('default');
  }

  private static resizeCursor(handleIndex: number): string {
    // 0: top-left, 3: bottom-right → nwse
    // 1: top-right, 2: bottom-left → nesw
    return handleIndex === 0 || handleIndex === 3
      ? 'nwse-resize'
      : 'nesw-resize';
  }

  private reset() {
    this.mode = SelectMode.None;
    this.movingElements = [];
    this.scalingElement = null;
    this.lassoPath = [];
  }

  private hitHandle(
    element: DrawableElement,
    point: Vector2,
    zoom: number,
  ): number {
    const handles = element.getHandles();
    const hitRadius = HANDLE_HIT_RADIUS / zoom;
    for (let i = 0; i < handles.length; i++) {
      const dx = point.x - handles[i].x;
      const dy = point.y - handles[i].y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return i;
      }
    }
    return -1;
  }

  public getOptions(): ToolOption[] {
    return [
      {
        type: 'choice',
        key: 'selectionStyle',
        label: 'Mode',
        value: this.selectionStyle,
        choices: [
          { value: 'rectangle', label: 'Rectangle', icon: BoxSelectIcon },
          { value: 'lasso', label: 'Lasso', icon: LassoIcon },
        ],
      },
    ];
  }

  public setOption(key: string, value: unknown): void {
    if (key === 'selectionStyle') {
      this.selectionStyle = value as 'rectangle' | 'lasso';
    }
  }

  public get icon(): SvgIcon {
    return PointerIcon;
  }

  public get label(): string {
    return 'Select';
  }
}
