import {
  BoxSelect as BoxSelectIcon,
  Lasso as LassoIcon,
  MousePointer2 as PointerIcon,
} from 'lucide-react';
import { isApplePlatform } from '@myelin/shared/os';
import { getCanvasPalette } from '../canvas-theme';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import {
  type DrawableElement,
  MIN_SCALE,
  type ResizeHandle,
} from '../elements/drawable-element';
import { ElementType, isBackgroundElement } from '../elements/element-type';
import type { MessageGetter } from '../i18n';
import type { DrawingContext } from '../rendering/painter';
import { CollisionHelper } from '../utils/collision-helper';
import type { ITool, SvgIcon, ToolId, ToolOption } from './tool';

enum SelectMode {
  None,
  Moving,
  Scaling,
  Marquee,
  Lasso,
}

const DOUBLE_CLICK_SLOP_PX = 8;

interface ElementTransformSnapshot {
  element: DrawableElement;
  offset: Vector2;
  scale: Vector2;
}

interface ElementScaleInteraction {
  kind: 'element';
  element: DrawableElement;
  handle: ResizeHandle;
  anchorWorld: Vector2;
  originalScale: Vector2;
  originalOffset: Vector2;
  originalDraggedWorld: Vector2;
}

interface GroupScaleInteraction {
  kind: 'group';
  handle: ResizeHandle;
  anchorWorld: Vector2;
  originalDraggedWorld: Vector2;
  transforms: ElementTransformSnapshot[];
}

type ScaleInteraction = ElementScaleInteraction | GroupScaleInteraction;

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
  private scaleInteraction: ScaleInteraction | null = null;
  private scaleChanged = false;

  // Lasso state
  private lassoPath: Vector2[] = [];

  // Backdrop click state: the element a marquee started on top of, selected on
  // finish() if the marquee caught nothing.
  private backdropClickCandidate: DrawableElement | null = null;

  // Double-click state
  private lastClickTime: number = 0;
  private lastClickPos: Vector2 = { x: 0, y: 0 };

  // Click-to-edit state: clicking an already-selected page frame without
  // dragging re-enters edit mode (file-rename pattern). Resolved on finish().
  private clickToEditCandidate: DrawableElement | null = null;

  get id(): ToolId {
    return 'select';
  }

  public drawCursor(ctx: DrawingContext, position: Vector2): void {
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
    this.lastPoint = point;

    // Cmd on macOS / Ctrl on Windows, matching the app-wide convention and avoiding the macOS
    // Ctrl+click right-click gesture.
    const additive = isApplePlatform ? event.metaKey : event.ctrlKey;

    const selectedElements = canvas.getSelectedElements();
    const selectionBounds = canvas.getSelectedElementBounds();
    const insideSelectionBounds =
      selectionBounds !== null && CollisionHelper.inBox(point, selectionBounds);

    // The selection body wins where a large touch target overlaps a handle. Handle centres sit
    // outside the content bounds, so they remain reachable without stealing thin strokes' interior.
    const handle = canvas.hitSelectionHandle(point, event.pointerType);
    if (!insideSelectionBounds || handle?.control) {
      if (handle) {
        this.mode = SelectMode.Scaling;
        if (selectedElements.length > 1 && selectionBounds) {
          this.scaleInteraction = {
            kind: 'group',
            handle,
            anchorWorld: {
              x: selectionBounds.x + selectionBounds.width * handle.anchorFx,
              y: selectionBounds.y + selectionBounds.height * handle.anchorFy,
            },
            originalDraggedWorld: {
              x:
                selectionBounds.x +
                selectionBounds.width * (1 - handle.anchorFx),
              y:
                selectionBounds.y +
                selectionBounds.height * (1 - handle.anchorFy),
            },
            transforms: selectedElements
              .filter((element) => !element.locked)
              .map((element) => ({
                element,
                offset: { ...element.offset },
                scale: { ...element.scale },
              })),
          };
        } else {
          const element = selectedElements[0];
          if (!element) {
            this.reset();
            return;
          }
          this.scaleInteraction = {
            kind: 'element',
            element,
            handle,
            originalScale: { ...element.scale },
            originalOffset: { ...element.offset },
            anchorWorld: handle.anchor,
            originalDraggedWorld: handle.position,
          };
          element.beginResize();
        }
        return;
      }
    }

    // 2. Double-click detection for element editing
    const now = Date.now();
    const dx = point.x - this.lastClickPos.x;
    const dy = point.y - this.lastClickPos.y;
    const doubleClickSlop = DOUBLE_CLICK_SLOP_PX / canvas.viewport.zoom;
    const isDoubleClick =
      now - this.lastClickTime < 400 &&
      dx * dx + dy * dy < doubleClickSlop * doubleClickSlop;

    if (isDoubleClick && !additive && canvas.enterEditAtPoint(point, event)) {
      this.lastClickTime = 0;
      return;
    }

    // 3. Hit-test elements (topmost first), cycle on repeated clicks
    const hits: DrawableElement[] = [];
    for (let i = canvas.elements.length - 1; i >= 0; i--) {
      const e = canvas.elements[i];
      if (CollisionHelper.inBox(point, e.boundingBox)) {
        hits.push(e);
      }
    }

    if (hits.length > 0 && additive) {
      // Toggle the topmost hit in/out of the selection (no cycle-through).
      const pick = hits[0];
      if (pick.isSelected) {
        pick.unselect();
      } else {
        pick.select();
        this.beginMove(
          canvas.elements.filter((element) => element.isSelected),
          point,
        );
      }
      this.lastCycledElement = null;
      return;
    }

    if (selectedElements.length > 1 && insideSelectionBounds) {
      this.beginMove(selectedElements, point);
      return;
    }

    // An unselected backdrop (page frame, PDF) doesn't grab: a drag on its body draws a marquee over
    // what is on top of it. A marquee that catches nothing was a click on the backdrop after all —
    // finish() selects it then.
    const grabbable = hits.filter((e) => e.grabsFromBody);

    if (grabbable.length > 0) {
      const selectedHit = grabbable.find((e) => e.isSelected);
      let pick = selectedHit ?? grabbable[0];
      this.pendingCycle = null;

      if (selectedHit) {
        if (
          grabbable.length > 1 &&
          this.lastCycledElement &&
          grabbable.includes(this.lastCycledElement)
        ) {
          this.pendingCycle = { hits: grabbable, from: this.lastCycledElement };
        } else {
          this.lastCycledElement = pick;
        }
      } else {
        if (
          grabbable.length > 1 &&
          this.lastCycledElement &&
          grabbable.includes(this.lastCycledElement)
        ) {
          const idx = grabbable.indexOf(this.lastCycledElement);
          pick = grabbable[(idx + 1) % grabbable.length];
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

      this.beginMove(
        canvas.elements.filter((element) => element.isSelected),
        point,
      );

      // Clicking an already-selected editable element (without dragging)
      // re-enters edit mode.
      if (
        pick.editable &&
        pick.entersEditOnSelectedClick &&
        pick.type !== ElementType.IMAGE &&
        wasAlreadySelected &&
        !this.pendingCycle
      ) {
        this.clickToEditCandidate = pick;
      }
      return;
    }

    const interactionBounds = canvas.getSelectionInteractionBounds(
      event.pointerType,
    );
    if (
      selectedElements.length > 0 &&
      interactionBounds &&
      CollisionHelper.inBox(point, interactionBounds)
    ) {
      this.beginMove(selectedElements, point);
      return;
    }

    // Modifier+click on empty space preserves the current selection.
    if (additive) {
      return;
    }

    // 3. Empty space (or a backdrop body) → marquee or lasso
    if (canvas.isCanvasInteractiveEditMode) {
      canvas.exitElementEdit();
    }
    this.lastCycledElement = null;
    this.backdropClickCandidate = hits[0] ?? null;
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
        const interaction = this.scaleInteraction;
        if (!interaction) {
          break;
        }
        if (interaction.kind === 'group') {
          this.updateGroupScale(interaction, position);
          break;
        }
        const e = interaction.element;
        const h = interaction.handle;
        const localBox = e.localBoundingBox;
        if (localBox.width === 0 || localBox.height === 0) {
          break;
        }

        const origDist = {
          x: interaction.originalDraggedWorld.x - interaction.anchorWorld.x,
          y: interaction.originalDraggedWorld.y - interaction.anchorWorld.y,
        };
        const curDist = {
          x: origDist.x + position.x - this.startPoint.x,
          y: origDist.y + position.y - this.startPoint.y,
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
          originalScale: interaction.originalScale,
          originalOffset: interaction.originalOffset,
          ratioX,
          ratioY,
          anchorWorld: interaction.anchorWorld,
          pointerWorld: position,
        });
        if (
          position.x !== this.startPoint.x ||
          position.y !== this.startPoint.y
        ) {
          this.scaleChanged = true;
        }
        break;
      }
      case SelectMode.Marquee: {
        this.lastPoint = position;
        const marqueeRect = new DOMRect(
          Math.min(this.startPoint.x, position.x),
          Math.min(this.startPoint.y, position.y),
          Math.abs(position.x - this.startPoint.x),
          Math.abs(position.y - this.startPoint.y),
        );
        for (const e of canvas.elements) {
          const box = e.boundingBox;
          const overlap = CollisionHelper.overlappingAreaOf2Rect(
            marqueeRect,
            box,
          );
          if (
            !e.locked &&
            overlap >
              (isBackgroundElement(e.type) ? box.width * box.height * 0.5 : 0)
          ) {
            e.select();
          } else {
            e.unselect();
          }
        }
        break;
      }
      case SelectMode.Lasso: {
        this.lastPoint = position;
        this.lassoPath.push(position);
        const poly = this.lassoPath;
        for (const e of canvas.elements) {
          const box = e.boundingBox;
          const center: Vector2 = {
            x: box.x + box.width * 0.5,
            y: box.y + box.height * 0.5,
          };
          if (!e.locked && CollisionHelper.isPointInPolygon(center, poly)) {
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
        if (this.scaleInteraction?.kind === 'element') {
          this.scaleInteraction.element.endResize();
        }
        break;
      }
      case SelectMode.Marquee:
      case SelectMode.Lasso: {
        // Nothing caught means the gesture was a click on the backdrop it
        // started from, not a selection of what sits on top of it.
        const backdrop = this.backdropClickCandidate;
        if (
          backdrop &&
          !canvas.elements.some((e) => e.isSelected) &&
          (!backdrop.locked ||
            Math.hypot(
              this.lastPoint.x - this.startPoint.x,
              this.lastPoint.y - this.startPoint.y,
            ) <=
              DOUBLE_CLICK_SLOP_PX / canvas.viewport.zoom)
        ) {
          backdrop.select();
          this.lastCycledElement = backdrop;
        }
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
      this.movingElements.length > 0 &&
      (this.totalDelta.x !== 0 || this.totalDelta.y !== 0)
    ) {
      canvas.undo();
    }
    if (this.mode === SelectMode.Scaling && this.scaleInteraction) {
      const interaction = this.scaleInteraction;
      let changed: boolean;
      if (interaction.kind === 'element') {
        const e = interaction.element;
        changed =
          this.scaleChanged ||
          e.scale.x !== interaction.originalScale.x ||
          e.scale.y !== interaction.originalScale.y ||
          e.offset.x !== interaction.originalOffset.x ||
          e.offset.y !== interaction.originalOffset.y;
        e.endResize();
      } else {
        changed = interaction.transforms.some(
          ({ element, offset, scale }) =>
            element.scale.x !== scale.x ||
            element.scale.y !== scale.y ||
            element.offset.x !== offset.x ||
            element.offset.y !== offset.y,
        );
      }
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
    if (this.mode === SelectMode.Scaling && this.scaleInteraction) {
      canvas.setCursor(this.scaleInteraction.handle.cursor);
      return;
    }

    const selectionBounds = canvas.getSelectedElementBounds();
    const insideSelectionBounds =
      selectionBounds !== null &&
      CollisionHelper.inBox(position, selectionBounds);
    const handle = canvas.hitSelectionHandle(position, 'mouse');
    if (!insideSelectionBounds || handle?.control) {
      if (handle) {
        canvas.setCursor(handle.cursor);
        return;
      }
    }

    const interactionBounds = canvas.getSelectionInteractionBounds('mouse');
    if (
      canvas.getSelectedElements().some((element) => !element.locked) &&
      interactionBounds &&
      CollisionHelper.inBox(position, interactionBounds)
    ) {
      canvas.setCursor('move');
      return;
    }

    canvas.setCursor('default');
  }

  private reset() {
    this.mode = SelectMode.None;
    this.movingElements = [];
    this.scaleInteraction = null;
    this.scaleChanged = false;
    this.lassoPath = [];
    this.pendingCycle = null;
    this.clickToEditCandidate = null;
    this.backdropClickCandidate = null;
  }

  private beginMove(elements: DrawableElement[], point: Vector2): void {
    this.mode = SelectMode.Moving;
    this.lastPoint = point;
    this.totalDelta = { x: 0, y: 0 };
    this.movingElements = elements.filter((element) => !element.locked);
  }

  private updateGroupScale(
    interaction: GroupScaleInteraction,
    position: Vector2,
  ): void {
    const pointerDelta = {
      x: position.x - this.startPoint.x,
      y: position.y - this.startPoint.y,
    };
    const originalDistance = {
      x: interaction.originalDraggedWorld.x - interaction.anchorWorld.x,
      y: interaction.originalDraggedWorld.y - interaction.anchorWorld.y,
    };
    const currentDistance = {
      x: originalDistance.x + pointerDelta.x,
      y: originalDistance.y + pointerDelta.y,
    };
    const ratios: number[] = [];
    if (originalDistance.x !== 0) {
      ratios.push(currentDistance.x / originalDistance.x);
    }
    if (originalDistance.y !== 0) {
      ratios.push(currentDistance.y / originalDistance.y);
    }
    if (ratios.length === 0) {
      return;
    }
    const ratio = Math.max(
      MIN_SCALE,
      ratios.reduce((best, candidate) =>
        Math.abs(candidate) > Math.abs(best) ? candidate : best,
      ),
    );
    const anchor = interaction.anchorWorld;
    for (const snapshot of interaction.transforms) {
      snapshot.element.setScale(
        snapshot.scale.x * ratio,
        snapshot.scale.y * ratio,
      );
      const targetOffset = {
        x: anchor.x + (snapshot.offset.x - anchor.x) * ratio,
        y: anchor.y + (snapshot.offset.y - anchor.y) * ratio,
      };
      snapshot.element.translate(
        targetOffset.x - snapshot.element.offset.x,
        targetOffset.y - snapshot.element.offset.y,
      );
    }
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
