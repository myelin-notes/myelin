import {
  BoxSelect as BoxSelectIcon,
  Lasso as LassoIcon,
  MousePointer2 as PointerIcon,
} from 'lucide-react';
import { getCanvasPalette } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type {
  DrawableElement,
  ResizeHandle,
} from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';
import type { MessageGetter } from '../i18n';
import { CollisionHelper } from '../utils/collision-helper';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

const HANDLE_HIT_RADIUS = 10;

enum SelectMode {
  None,
  Moving,
  Scaling,
  Marquee,
  Lasso,
}

export class SelectTool implements ITool {
  public constructor(private readonly getStrings: MessageGetter) {}

  private mode: SelectMode = SelectMode.None;
  private startPoint: Vector2 = { x: 0, y: 0 };
  private selectionStyle: 'rectangle' | 'lasso' = 'rectangle';

  // Move state
  private lastPoint: Vector2 = { x: 0, y: 0 };
  private totalDelta: Vector2 = { x: 0, y: 0 };
  private movingElements: DrawableElement[] = [];

  // Cycle-through state
  private lastCycledElement: DrawableElement | null = null;
  private pendingCycle: {
    hits: DrawableElement[];
    from: DrawableElement;
  } | null = null;

  // Scale state
  private scalingElement: DrawableElement | null = null;
  private scalingHandle: ResizeHandle | null = null;
  private anchorWorld: Vector2 = { x: 0, y: 0 };
  private originalScale: Vector2 = { x: 1, y: 1 };
  private originalOffset: Vector2 = { x: 0, y: 0 };
  private originalDraggedWorld: Vector2 = { x: 0, y: 0 };

  // Lasso state
  private lassoPath: Vector2[] = [];

  // Double-click state
  private lastClickTime: number = 0;
  private lastClickPos: Vector2 = { x: 0, y: 0 };

  // Click-to-edit state: clicking an already-selected page frame without
  // dragging re-enters edit mode (file-rename pattern). Resolved on finish().
  private clickToEditCandidate: DrawableElement | null = null;

  get id(): ToolId {
    return 'select';
  }

  public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
    const palette = getCanvasPalette();
    if (this.mode === SelectMode.Marquee) {
      const x = Math.min(this.startPoint.x, position.x);
      const y = Math.min(this.startPoint.y, position.y);
      const w = Math.abs(position.x - this.startPoint.x);
      const h = Math.abs(position.y - this.startPoint.y);

      ctx.fillStyle = palette.selectionFill;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 3);
      ctx.fill();

      ctx.strokeStyle = palette.selectionStroke;
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

      ctx.fillStyle = palette.selectionFill;
      ctx.fill();

      ctx.strokeStyle = palette.selectionStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  public start(canvas: DrawableCanvas, event: PointerEvent): void {
    const point = canvas.viewport.getPoint(event);
    this.startPoint = point;

    // 1. Check handles on selected elements first
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (!e.isSelected) {
        continue;
      }
      const handle = this.hitHandle(e, point, canvas.viewport.zoom);
      if (handle) {
        this.mode = SelectMode.Scaling;
        this.scalingElement = e;
        this.scalingHandle = handle;
        this.originalScale = { ...e.scale };
        this.originalOffset = { ...e.offset };
        this.anchorWorld = handle.anchor;
        this.originalDraggedWorld = handle.position;
        e.beginResize();
        return;
      }
    }

    // 2. Double-click detection for element editing
    const now = Date.now();
    const dx = point.x - this.lastClickPos.x;
    const dy = point.y - this.lastClickPos.y;
    const isDoubleClick =
      now - this.lastClickTime < 400 && dx * dx + dy * dy < 25;

    if (isDoubleClick) {
      for (let i = canvas.elements.length - 1; i >= 0; i--) {
        const e = canvas.elements[i];
        if (!CollisionHelper.inBox(point, e.boundingBox)) {
          continue;
        }
        if (e.editable) {
          for (const el of canvas.elements) {
            if (el !== e) {
              el.unselect();
            }
          }
          e.select();
          canvas.enterElementEdit(e, event);
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
      const selectedHit = hits.find((e) => e.isSelected);
      let pick = selectedHit ?? hits[0];
      this.pendingCycle = null;

      if (selectedHit) {
        if (
          hits.length > 1 &&
          this.lastCycledElement &&
          hits.includes(this.lastCycledElement)
        ) {
          this.pendingCycle = { hits, from: this.lastCycledElement };
        } else {
          this.lastCycledElement = pick;
        }
      } else {
        if (
          hits.length > 1 &&
          this.lastCycledElement &&
          hits.includes(this.lastCycledElement)
        ) {
          const idx = hits.indexOf(this.lastCycledElement);
          pick = hits[(idx + 1) % hits.length];
        }
        this.lastCycledElement = pick;
      }

      const wasAlreadySelected = pick.isSelected;

      if (
        canvas.isCanvasInteractiveEditMode &&
        canvas.editingElement !== pick
      ) {
        canvas.exitElementEdit();
      }

      if (!wasAlreadySelected) {
        for (const e of canvas.elements) {
          e.unselect();
        }
        pick.select();
      }

      this.mode = SelectMode.Moving;
      this.lastPoint = point;
      this.totalDelta = { x: 0, y: 0 };
      this.movingElements = canvas.elements.filter((e) => e.isSelected);

      // Clicking an already-selected editable element (without dragging)
      // re-enters edit mode.
      if (
        pick.editable &&
        pick.type !== ElementType.IMAGE &&
        wasAlreadySelected &&
        !this.pendingCycle
      ) {
        this.clickToEditCandidate = pick;
      }
      return;
    }

    // 3. Empty space → marquee or lasso
    if (canvas.isCanvasInteractiveEditMode) {
      canvas.exitElementEdit();
    }
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
        if (!this.scalingElement || !this.scalingHandle) {
          break;
        }
        const e = this.scalingElement;
        const h = this.scalingHandle;
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

        let ratioX = h.scaleX && origDist.x !== 0 ? curDist.x / origDist.x : 1;
        let ratioY = h.scaleY && origDist.y !== 0 ? curDist.y / origDist.y : 1;

        const uniformScale =
          h.scaleX && h.scaleY && (_event.shiftKey || e.maintainAspectRatio);
        if (uniformScale) {
          const uniform = Math.abs(ratioX) > Math.abs(ratioY) ? ratioX : ratioY;
          ratioX = uniform;
          ratioY = uniform;
        }

        e.applyResize({
          handle: h,
          originalScale: this.originalScale,
          originalOffset: this.originalOffset,
          ratioX,
          ratioY,
          anchorWorld: this.anchorWorld,
        });
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
        const poly = this.lassoPath;
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

  public finish(canvas: DrawableCanvas, event: PointerEvent): void {
    switch (this.mode) {
      case SelectMode.Moving: {
        if (this.totalDelta.x === 0 && this.totalDelta.y === 0) {
          if (this.pendingCycle) {
            this.cyclePendingSelection(canvas);
          } else if (this.clickToEditCandidate) {
            canvas.enterElementEdit(this.clickToEditCandidate, event);
          }
        }
        // Yjs captures translate() mutations automatically — no command needed
        break;
      }
      case SelectMode.Scaling: {
        // Yjs captures mutations automatically — no command needed
        this.scalingElement?.endResize();
        break;
      }
    }

    this.lastClickTime = Date.now();
    this.lastClickPos = { ...this.startPoint };
    this.reset();
  }

  public interrupt(canvas: DrawableCanvas): void {
    if (
      this.mode === SelectMode.Moving &&
      (this.totalDelta.x !== 0 || this.totalDelta.y !== 0)
    ) {
      canvas.undo();
    }
    if (this.mode === SelectMode.Scaling && this.scalingElement) {
      const e = this.scalingElement;
      const changed =
        e.scale.x !== this.originalScale.x ||
        e.scale.y !== this.originalScale.y ||
        e.offset.x !== this.originalOffset.x ||
        e.offset.y !== this.originalOffset.y;
      e.endResize();
      if (changed) {
        canvas.undo();
      }
    }
    this.lastCycledElement = null;
    this.reset();
  }

  public hover(canvas: DrawableCanvas, position: Vector2): void {
    if (this.mode === SelectMode.Moving) {
      canvas.setCursor('move');
      return;
    }
    if (this.mode === SelectMode.Scaling && this.scalingHandle) {
      canvas.setCursor(this.scalingHandle.cursor);
      return;
    }

    // Idle — check handles on selected elements
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (!e.isSelected) {
        continue;
      }
      const handle = this.hitHandle(e, position, canvas.viewport.zoom);
      if (handle) {
        canvas.setCursor(handle.cursor);
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

  private reset() {
    this.mode = SelectMode.None;
    this.movingElements = [];
    this.scalingElement = null;
    this.scalingHandle = null;
    this.lassoPath = [];
    this.pendingCycle = null;
    this.clickToEditCandidate = null;
  }

  private cyclePendingSelection(canvas: DrawableCanvas): void {
    if (!this.pendingCycle) {
      return;
    }
    const hits = this.pendingCycle.hits.filter((hit) =>
      canvas.elements.includes(hit),
    );
    if (hits.length === 0) {
      return;
    }
    const idx = hits.indexOf(this.pendingCycle.from);
    const pick = hits[(idx + 1) % hits.length] ?? hits[0];
    for (const e of canvas.elements) {
      e.unselect();
    }
    pick.select();
    this.lastCycledElement = pick;
  }

  private hitHandle(
    element: DrawableElement,
    point: Vector2,
    zoom: number,
  ): ResizeHandle | null {
    const handles = element.getHandles();
    const hitRadius = HANDLE_HIT_RADIUS / zoom;
    for (const h of handles) {
      const dx = point.x - h.position.x;
      const dy = point.y - h.position.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return h;
      }
    }
    return null;
  }

  public getOptions(): ToolOption[] {
    const strings = this.getStrings().canvas;
    return [
      {
        type: 'choice',
        key: 'selectionStyle',
        label: strings.toolOptions.mode,
        value: this.selectionStyle,
        set: (selectionStyle) => {
          this.selectionStyle = selectionStyle as 'rectangle' | 'lasso';
        },
        choices: [
          {
            value: 'rectangle',
            label: strings.toolOptions.rectangle,
            icon: BoxSelectIcon,
          },
          {
            value: 'lasso',
            label: strings.toolOptions.lasso,
            icon: LassoIcon,
          },
        ],
      },
    ];
  }

  public get icon(): SvgIcon {
    return PointerIcon;
  }

  public get label(): string {
    return this.getStrings().canvas.tools.select;
  }
}
