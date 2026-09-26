import type { CanvasViewport } from './canvas-viewport';
import type { DrawableCanvas, Vector2 } from './drawable-canvas';
import { InputModeController } from './input-mode';
import { PalmRejection } from './palm-rejection';
import type { ITool, ToolId } from './tools/tool';
import { UserPrefs } from './user-prefs';
import { StateMachine } from './utils/state-machine';

const TOUCH_TAP_SLOP = 8;
const PEN_ERASER_BUTTONS = 32 | 2;
const PEN_CONTACT_BUTTONS = 1 | 32;
const PEN_WHEEL_BUTTONS = 4;
const LONG_FRAME_MS = 25;

export function coalescedPointerSamples(
  event: PointerEvent,
  prevTimeStamp: number,
): PointerEvent[] {
  if (event.timeStamp - prevTimeStamp < LONG_FRAME_MS) {
    return [event];
  }
  const samples = event.getCoalescedEvents?.() ?? [];
  return samples.length > 0 ? samples : [event];
}

export function isStylusTouch(event: TouchEvent): boolean {
  for (const touch of Array.from(event.changedTouches)) {
    if ((touch as Touch & { touchType?: string }).touchType === 'stylus') {
      return true;
    }
  }
  return false;
}

export interface CanvasInteractionHost {
  drawableCanvas: DrawableCanvas;
  canvas: HTMLCanvasElement;
  viewport: CanvasViewport;
  getActiveTool: () => ITool;
  setActiveTool: (tool: ITool) => void;
  getTools: () => readonly ITool[];
  clearSelection: () => void;
  stopUndoCapturing: () => void;
  isPlacementActive: () => boolean;
  placeAt: (position: Vector2) => void;
  endPlacement: () => void;
  enterEditAtPoint: (point: Vector2, event: Event) => boolean;
  refreshRendererSize: () => void;
}

export class CanvasInteractionController {
  private readonly state: StateMachine<InteractState> = new StateMachine(
    InteractState.Idle,
  );
  private readonly palm = new PalmRejection();
  private readonly input = new InputModeController();
  private readonly activeTouchPointers = new Set<number>();
  private touchPanStartOffset: Vector2 | null = null;
  private screenPosition: Vector2 = { x: 0, y: 0 };
  private lastTouchTapTime = 0;
  private lastTouchTapScreenPos: Vector2 = { x: 0, y: 0 };
  private touchTapCandidate: Vector2 | null = null;
  private abortingInteraction = false;
  private eraserOverride: ITool | null = null;
  private eraserButtonsHeld = false;
  private eraserOverrideApplied = false;
  private penContactOpen = false;
  private interactionPointer: { id: number; pen: boolean } | null = null;
  private lastToolSampleTime = 0;
  private toolCursor = 'default';
  private appliedCursor: string | null = null;
  private spaceDown = false;
  private onToolSwitched?: (index: number) => void;

  private readonly handlePointerDown: (event: PointerEvent) => void;
  private readonly handlePointerMove: (event: PointerEvent) => void;
  private readonly handlePointerOver: (event: PointerEvent) => void;
  private readonly handlePointerOut: (event: PointerEvent) => void;
  private readonly handlePointerUp: (event: PointerEvent) => void;
  private readonly handleStylusTouch: (event: TouchEvent) => void;
  private readonly handleResize: () => void;

  public constructor(private readonly host: CanvasInteractionHost) {
    this.initStates();
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerOver = (event) => {
      if (
        event.pointerType === 'pen' &&
        event.buttons === 0 &&
        !this.palm.penHover
      ) {
        this.beginPenHover(event);
      }
    };
    this.handlePointerOut = (event) => {
      if (event.pointerType === 'pen' && event.relatedTarget === null) {
        this.palm.penHoverEnd();
      }
    };
    this.handlePointerUp = (event) => this.onPointerUp(event);
    this.handleStylusTouch = (event) => {
      if (event.cancelable && isStylusTouch(event)) {
        event.preventDefault();
      }
    };
    this.handleResize = () => {
      this.host.refreshRendererSize();
    };
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerover', this.handlePointerOver);
    window.addEventListener('pointerout', this.handlePointerOut);
    this.host.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    this.host.canvas.addEventListener('touchstart', this.handleStylusTouch, {
      passive: false,
    });
    this.host.canvas.addEventListener('touchend', this.handleStylusTouch);
    window.addEventListener('resize', this.handleResize);
  }

  public get selectedTool(): ITool {
    return this.host.getActiveTool();
  }

  public get cursorPosition(): Vector2 {
    return this.screenPosition;
  }

  public get palmSuppressed(): boolean {
    return this.palm.suppressed;
  }

  public get penIsErasing(): boolean {
    return this.eraserButtonsHeld;
  }

  public setOnToolSwitched(callback: (index: number) => void): void {
    this.onToolSwitched = callback;
  }

  public setToolCursor(cursor: string): void {
    this.toolCursor = cursor;
  }

  public setSpaceDown(value: boolean): void {
    this.spaceDown = value;
    this.updateCursor();
  }

  public startToolInteraction(event: PointerEvent): void {
    this.state.change(InteractState.UsingTool, event);
  }

  public abortInteraction(): void {
    if (this.state.current !== InteractState.UsingTool) {
      return;
    }
    this.abortingInteraction = true;
    this.state.change(InteractState.Idle, null);
    this.abortingInteraction = false;
  }

  public releaseTouchForToolWheel(): boolean {
    if (
      this.palm.suppressed ||
      !this.input.touchDrivesTool ||
      this.state.current !== InteractState.UsingTool
    ) {
      return false;
    }
    this.touchTapCandidate = null;
    this.abortInteraction();
    return true;
  }

  public switchTool(index: number): void {
    this.eraserOverride = null;
    this.eraserButtonsHeld = false;
    this.eraserOverrideApplied = false;
    this.selectedTool.interrupt(this.host.drawableCanvas);
    const next = this.host.getTools()[index];
    if (!next.applyOptionToSelection) {
      this.host.clearSelection();
    }
    this.host.setActiveTool(next);
    this.toolCursor = 'default';
    this.updateCursor();
    this.onToolSwitched?.(index);
  }

  public switchToTool(id: ToolId): void {
    const index = this.host.getTools().findIndex((tool) => tool.id === id);
    if (index >= 0) {
      this.switchTool(index);
    }
  }

  public destroy(): void {
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerover', this.handlePointerOver);
    window.removeEventListener('pointerout', this.handlePointerOut);
    this.host.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    this.host.canvas.removeEventListener('touchstart', this.handleStylusTouch);
    this.host.canvas.removeEventListener('touchend', this.handleStylusTouch);
    window.removeEventListener('resize', this.handleResize);
    this.input.destroy();
  }

  private initStates(): void {
    this.state.addEnd(InteractState.UsingTool, (event) => {
      this.interactionPointer = null;
      if (this.abortingInteraction) {
        const tool = this.selectedTool;
        if (tool.abort) {
          tool.abort(this.host.drawableCanvas);
        } else {
          tool.interrupt(this.host.drawableCanvas);
        }
      } else {
        this.selectedTool.finish(this.host.drawableCanvas, event);
      }
      this.host.stopUndoCapturing();
    });
    this.state.addStart(InteractState.UsingTool, (event: PointerEvent) => {
      this.interactionPointer = {
        id: event.pointerId,
        pen: event.pointerType === 'pen',
      };
      this.host.stopUndoCapturing();
      this.lastToolSampleTime = event.timeStamp;
      this.selectedTool.start(this.host.drawableCanvas, event);
    });
    this.state.addUpdate(InteractState.UsingTool, (event: PointerEvent) => {
      const samples = coalescedPointerSamples(event, this.lastToolSampleTime);
      this.lastToolSampleTime = event.timeStamp;
      for (const sample of samples) {
        this.selectedTool.update(
          this.host.drawableCanvas,
          sample,
          this.host.viewport.getPoint(sample),
        );
      }
    });
    this.state.addStart(InteractState.Moving, (event: PointerEvent) => {
      this.interactionPointer = { id: event.pointerId, pen: false };
      if (event.pointerType === 'touch') {
        this.touchPanStartOffset = { ...this.host.viewport.offset };
        this.host.viewport.beginPanGesture(event.timeStamp);
      }
      this.updateCursor();
    });
    this.state.addEnd(InteractState.Moving, (event: PointerEvent) => {
      this.interactionPointer = null;
      const startOffset = this.touchPanStartOffset;
      this.touchPanStartOffset = null;
      if (
        startOffset &&
        (event.type === 'pointercancel' ||
          this.palm.penContact ||
          this.palm.penHover)
      ) {
        this.host.viewport.setView({
          zoom: this.host.viewport.zoom,
          offset: startOffset,
        });
        this.updateCursor();
        return;
      }
      if (event.pointerType === 'touch') {
        this.host.viewport.endPanGesture(event.timeStamp);
      }
      this.updateCursor();
    });
    this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
      const dx = event.movementX / this.host.viewport.zoom;
      const dy = event.movementY / this.host.viewport.zoom;
      if (event.pointerType === 'touch') {
        this.host.viewport.panGestureBy(dx, dy, event.timeStamp);
      } else {
        this.host.viewport.panBy(dx, dy);
      }
    });
  }

  private onPointerMove(event: PointerEvent): void {
    if (
      event.pointerType === 'pen' &&
      event.buttons === 0 &&
      !this.palm.penHover
    ) {
      this.beginPenHover(event);
    }
    if (this.palm.isKnownPalm(event.pointerId)) {
      return;
    }
    this.syncEraserOverride(event);
    this.syncPenChordedContact(event);
    if (!this.ownsInteraction(event)) {
      return;
    }
    this.screenPosition = this.host.viewport.getScreenPoint(event);
    this.state.update(event);
    if (event.target === this.host.canvas) {
      this.selectedTool.hover?.(
        this.host.drawableCanvas,
        this.host.viewport.screenToWorld(this.screenPosition),
      );
    }
    this.updateCursor();
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'touch' && this.palm.isPalm(event.pointerId)) {
      return;
    }
    if (this.host.isPlacementActive()) {
      if (event.button === 0) {
        this.host.placeAt(this.host.viewport.getPoint(event));
      }
      this.host.endPlacement();
      return;
    }
    switch (event.pointerType) {
      case 'touch':
        this.startTouchInteraction(event);
        return;
      case 'pen':
        if (event.buttons & PEN_WHEEL_BUTTONS) {
          return;
        }
        this.syncEraserOverride(event);
        if (!(event.buttons & PEN_CONTACT_BUTTONS)) {
          return;
        }
        this.penContactOpen = true;
        this.beginPenContact(event);
        this.state.change(InteractState.UsingTool, event);
        this.state.update(event);
        return;
      case 'mouse':
        if (this.spaceDown || event.button === 1) {
          this.state.change(InteractState.Moving, event);
          this.state.update(event);
          return;
        }
        if (event.button === 2) {
          return;
        }
    }
    this.state.change(InteractState.UsingTool, event);
    this.state.update(event);
  }

  private startTouchInteraction(event: PointerEvent): void {
    this.activeTouchPointers.add(event.pointerId);
    if (this.activeTouchPointers.size >= 2) {
      this.touchTapCandidate = null;
      if (this.input.touchDrivesTool) {
        this.abortInteraction();
      }
      this.state.change(InteractState.Idle, event);
      return;
    }
    if (this.input.touchDrivesTool) {
      this.touchTapCandidate = null;
      this.state.change(InteractState.UsingTool, event);
      this.state.update(event);
      return;
    }
    const now = Date.now();
    const dx = event.clientX - this.lastTouchTapScreenPos.x;
    const dy = event.clientY - this.lastTouchTapScreenPos.y;
    const isDoubleTap =
      now - this.lastTouchTapTime < 400 &&
      dx * dx + dy * dy < TOUCH_TAP_SLOP * TOUCH_TAP_SLOP;
    const point = this.host.viewport.getPoint(event);
    if (isDoubleTap && this.host.enterEditAtPoint(point, event)) {
      this.lastTouchTapTime = 0;
      return;
    }
    this.lastTouchTapTime = now;
    this.lastTouchTapScreenPos = { x: event.clientX, y: event.clientY };
    const selecting = this.selectedTool.id === 'select';
    if (
      selecting &&
      this.host.drawableCanvas.shouldUseSelectToolForTouch(point)
    ) {
      this.touchTapCandidate = null;
      this.state.change(InteractState.UsingTool, event);
      this.state.update(event);
      return;
    }
    this.touchTapCandidate = selecting
      ? { x: event.clientX, y: event.clientY }
      : null;
    this.state.change(InteractState.Moving, event);
    this.state.update(event);
  }

  private onPointerUp(event: PointerEvent): void {
    this.activeTouchPointers.delete(event.pointerId);
    if (event.type === 'pointercancel' && event.pointerType === 'pen') {
      this.palm.penHoverEnd();
    }
    if (this.palm.pointerUp(event.pointerId, event.pointerType === 'pen')) {
      return;
    }
    if (!this.ownsInteraction(event)) {
      return;
    }
    const tap = this.touchTapCandidate;
    this.touchTapCandidate = null;
    if (
      tap &&
      event.type === 'pointerup' &&
      event.pointerType === 'touch' &&
      this.state.current === InteractState.Moving &&
      Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= TOUCH_TAP_SLOP
    ) {
      this.state.change(InteractState.UsingTool, event);
    }
    this.state.change(InteractState.Idle, event);
    this.syncEraserOverride(event);
    if (event.pointerType === 'pen') {
      this.penContactOpen = false;
    }
  }

  private beginPenContact(event: PointerEvent): void {
    this.palm.penDown(event.pointerId, this.activeTouchPointers);
    this.rejectActiveTouches(event);
  }

  private beginPenHover(event: PointerEvent): void {
    this.palm.penHoverStart(this.activeTouchPointers);
    this.rejectActiveTouches(event);
  }

  private rejectActiveTouches(event: PointerEvent): void {
    if (this.activeTouchPointers.size > 0) {
      this.activeTouchPointers.clear();
      this.touchTapCandidate = null;
      this.abortInteraction();
      this.state.change(InteractState.Idle, event);
    }
  }

  private ownsInteraction(event: PointerEvent): boolean {
    const owner = this.interactionPointer;
    // Android can renumber a stylus mid-gesture.
    return (
      owner === null ||
      owner.id === event.pointerId ||
      (owner.pen && event.pointerType === 'pen')
    );
  }

  private syncPenChordedContact(event: PointerEvent): void {
    if (event.pointerType !== 'pen') {
      return;
    }
    const contact = (event.buttons & PEN_CONTACT_BUTTONS) !== 0;
    if (contact === this.penContactOpen) {
      return;
    }
    if (contact) {
      if (
        event.target !== this.host.canvas ||
        this.state.current !== InteractState.Idle
      ) {
        return;
      }
      this.penContactOpen = true;
      this.beginPenContact(event);
      this.state.change(InteractState.UsingTool, event);
      return;
    }
    this.penContactOpen = false;
    this.state.change(InteractState.Idle, event);
    this.palm.pointerUp(event.pointerId, true);
  }

  private syncEraserOverride(event: PointerEvent): void {
    if (event.pointerType !== 'pen') {
      return;
    }
    const reportedHeld = (event.buttons & PEN_ERASER_BUTTONS) !== 0;
    const penContact = (event.buttons & PEN_CONTACT_BUTTONS) !== 0;
    const penLifted = this.penContactOpen && !penContact;
    if (event.type === 'pointercancel') {
      this.eraserButtonsHeld = false;
      this.setEraserOverrideApplied(false, event);
      return;
    }
    if (event.button === 2 || penContact) {
      this.eraserButtonsHeld = reportedHeld;
    }
    if (
      UserPrefs.get('penBarrelButtonImmediate') ||
      !this.penContactOpen ||
      penLifted
    ) {
      this.setEraserOverrideApplied(this.eraserButtonsHeld, event);
    }
  }

  private setEraserOverrideApplied(
    applied: boolean,
    event: PointerEvent,
  ): void {
    if (applied === this.eraserOverrideApplied) {
      return;
    }
    this.eraserOverrideApplied = applied;
    if (
      (applied && (this.eraserOverride || this.selectedTool.id === 'eraser')) ||
      (!applied && !this.eraserOverride)
    ) {
      return;
    }
    const inFlight = this.state.current === InteractState.UsingTool;
    if (inFlight) {
      this.state.change(InteractState.Idle, event);
    }
    if (applied) {
      this.beginEraserOverride();
    } else {
      this.endEraserOverride();
    }
    if (inFlight && event.buttons & PEN_CONTACT_BUTTONS) {
      this.state.change(InteractState.UsingTool, event);
    }
  }

  private beginEraserOverride(): void {
    const eraser = this.host.getTools().find((tool) => tool.id === 'eraser');
    if (!eraser || this.eraserOverride || this.selectedTool === eraser) {
      return;
    }
    this.eraserOverride = this.selectedTool;
    this.host.setActiveTool(eraser);
  }

  private endEraserOverride(): void {
    if (this.eraserOverride) {
      this.host.setActiveTool(this.eraserOverride);
      this.eraserOverride = null;
    }
  }

  private updateCursor(): void {
    const cursor =
      this.state.current === InteractState.Moving
        ? 'grabbing'
        : this.spaceDown
          ? 'grab'
          : this.toolCursor;
    if (cursor !== this.appliedCursor) {
      this.appliedCursor = cursor;
      this.host.canvas.style.cursor = cursor;
    }
  }
}

enum InteractState {
  UsingTool,
  Moving,
  Idle,
}
