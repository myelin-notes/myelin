import * as Y from 'yjs';
import { Logger } from '@myelin/shared/logger';
import { CanvasRenderer } from './canvas-renderer';
import { CanvasViewport } from './canvas-viewport';
import { ElementStore } from './element-store';
import { AudioElement } from './elements/audio/element';
import type { DrawableElement } from './elements/drawable-element';
import {
  ELEMENT_FACTORIES,
  type ElementFactory,
} from './elements/element-factories';
import { ElementType, isBackgroundElement } from './elements/element-type';
import { PageFrameElement } from './elements/page-frame-element';
import { PdfElement } from './elements/pdf-element';
import type { Vector2 } from './geometry';
import { catalogs, type MessageGetter } from './i18n/messages';
import { InputModeController } from './input-mode';
import {
  describeElementType,
  summarizeDrawableElements,
} from './note/state-summary';
import type { ResolveMediaSrc } from './page-frame/pm/embed/renderer';
import type { ResolveNoteLink } from './page-frame/pm/markdown/note-links';
import { PalmRejection } from './palm-rejection';
import { PlacementController } from './placement-controller';
import type { LivePeersSnapshot } from './sync/live/peers';
import { EraserTool } from './tools/eraser-tool';
import { HighlighterTool } from './tools/highlighter-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { TextTool } from './tools/text-tool';
import type { ITool, ToolId } from './tools/tool';
import { CollisionHelper } from './utils/collision-helper';
import { StateMachine } from './utils/state-machine';
import { LOCAL_ORIGIN, type YDocManager } from './ydoc-manager';

export type { Vector2 } from './geometry';

export interface PlacementGhost {
  /** Bounds of the ghost rectangle, relative to the pointer's world position. */
  getBounds(): { x: number; y: number; width: number; height: number };
  /** Called when the user clicks to finalize placement. */
  onPlace(worldPos: Vector2): void;
}

const logger = new Logger('DrawableCanvas');

type YElementsDeepObserver = Parameters<
  Y.Array<Y.Map<unknown>>['observeDeep']
>[0];
type YElementsDeepEvents = Parameters<YElementsDeepObserver>[0];
type YElementsDeepTransaction = Parameters<YElementsDeepObserver>[1];
type YElementsDeepEvent = YElementsDeepEvents[number];

const ELEMENT_Z_ORDER_KEY = 'zOrder';

/** Screen-pixel travel a finger may drift and still count as a tap. */
const TOUCH_TAP_SLOP = 8;

// Buttons that erase for as long as they are held: the eraser end (Pointer Events L3; S Pen /
// Surface Pen / Wacom set it, Apple Pencil never does) and a barrel button. Also the contract the
// native layer rewrites to where the WebView hides a stylus button — see StylusEventRewriter.kt.
const PEN_ERASER_BUTTONS = 32 | 2;

/**
 * The bits that mean the stylus is on the glass: its tip, or its eraser end,
 * which replaces the tip bit rather than joining it.
 */
const PEN_CONTACT_BUTTONS = 1 | 32;

/** A second barrel button reports as the middle button, and opens the wheel. */
const PEN_WHEEL_BUTTONS = 4;

function getElementLayer(type: ElementType): number {
  return isBackgroundElement(type) ? 0 : 1;
}

function unionBoundingBoxes(
  elements: readonly DrawableElement[],
): DOMRect | null {
  const boxes = elements
    .map((e) => e.boundingBox)
    .filter((b) => b.width > 0 || b.height > 0);
  if (boxes.length === 0) {
    return null;
  }
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.right));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export type ElementReorderDirection = 'higher' | 'lower';

export interface ElementOrderItem {
  uuid: string;
  type: ElementType;
}

function canSwapElementOrder(
  a: ElementOrderItem,
  b: ElementOrderItem,
  selectedUuids: ReadonlySet<string>,
): boolean {
  return (
    getElementLayer(a.type) === getElementLayer(b.type) &&
    selectedUuids.has(a.uuid) &&
    !selectedUuids.has(b.uuid)
  );
}

export function canMoveElementOrderForSelection(
  items: readonly ElementOrderItem[],
  selectedUuids: Iterable<string>,
  direction: ElementReorderDirection,
): boolean {
  const selected = new Set(selectedUuids);
  if (selected.size === 0) {
    return false;
  }

  if (direction === 'higher') {
    for (let i = 0; i < items.length - 1; i++) {
      if (canSwapElementOrder(items[i], items[i + 1], selected)) {
        return true;
      }
    }
    return false;
  }

  for (let i = 1; i < items.length; i++) {
    if (canSwapElementOrder(items[i], items[i - 1], selected)) {
      return true;
    }
  }
  return false;
}

// A frame gap past this is a dropped frame, not the display's own cadence (16.7ms at 60Hz).
const LONG_FRAME_MS = 25;

// A stylus samples faster than the display refreshes, so the platform batches samples into one
// pointermove. Reading only the delivered event draws a straight chord across the batch — the
// flat segments in handwriting when a frame runs long. Only a long frame opens the batch: on a
// newer iPad the coalesced Apple Pencil samples knot a fast stroke, while one point per frame at
// 60–120Hz is already smooth. Falls back to the event where unsupported.
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

export function moveElementOrderForSelection(
  items: readonly ElementOrderItem[],
  selectedUuids: Iterable<string>,
  direction: ElementReorderDirection,
): string[] {
  const selected = new Set(selectedUuids);
  const next = [...items];

  if (direction === 'higher') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (canSwapElementOrder(next[i], next[i + 1], selected)) {
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
      }
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (canSwapElementOrder(next[i], next[i - 1], selected)) {
        [next[i], next[i - 1]] = [next[i - 1], next[i]];
      }
    }
  }

  return next.map((item) => item.uuid);
}

export class DrawableCanvas {
  public readonly ctx: CanvasRenderingContext2D;
  public readonly viewport: CanvasViewport;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: CanvasRenderer;
  private readonly state: StateMachine<InteractState>;
  public readonly tools: ITool[];

  private spaceDown: boolean = false;
  private screenPosition: Vector2 = { x: 0, y: 0 };

  // A single finger that starts a pan never reaches the select tool's double-click path.
  private _lastTouchTapTime: number = 0;
  private _lastTouchTapPos: Vector2 = { x: 0, y: 0 };

  // A finger that began panning with the select tool. If it lifts without dragging it was a tap,
  // replayed through the tool to select / clear.
  private _touchTapCandidate: Vector2 | null = null;

  // Two fingers are a viewport pinch/pan (CanvasViewport's touch listeners), so single-finger
  // pointer panning must yield while 2+ are down.
  private readonly _activeTouchPointers = new Set<number>();

  // Set for the duration of abortInteraction() so the UsingTool end handler
  // discards the interaction instead of committing it.
  private _abortingInteraction: boolean = false;

  // The tool to hand back when the eraser end or barrel button lifts, and the
  // held state that decides it — see syncEraserOverride.
  private _eraserOverride: ITool | null = null;
  private _eraserButtonsHeld: boolean = false;
  // Lets the contact edges a chorded button hides be spotted — see syncPenChordedContact.
  private _penContactOpen: boolean = false;
  private _lastToolSampleTime: number = 0;

  // While the stylus is on the glass — and briefly after — a hand resting on
  // the screen must drive nothing.
  private readonly _palm = new PalmRejection();

  // Whether a finger draws or pans — see InputModeController.
  private readonly _input = new InputModeController();

  private readonly _store = new ElementStore(() => this.notifyChange());
  private _ydoc: YDocManager;
  private _domOverlayHost: HTMLElement | null = null;
  private _toolCursor: string = 'default';
  /** Last value written to `canvas.style.cursor`. @see updateCursor */
  private _appliedCursor: string | null = null;
  private toolSelected: ITool;
  private readonly resolveNoteLink?: ResolveNoteLink;
  private readonly resolveMedia?: ResolveMediaSrc;
  private onPageFrameRenamed?: (
    uuid: string,
    newName: string,
    oldName: string,
  ) => void;

  private onElementEdit?: (element: DrawableElement | null) => void;
  private onToolSwitched?: (index: number) => void;

  // Event handlers (stored for cleanup in destroy())
  private _handlePointerDown!: (evt: PointerEvent) => void;
  private _handlePointerMove!: (evt: PointerEvent) => void;
  private _handlePointerUp!: (evt: PointerEvent) => void;
  private _handleResize!: () => void;
  private readonly _handleYElementsChange: YElementsDeepObserver = (
    events,
    transaction,
  ) => {
    this.handleYElementsChange(events, transaction);
  };

  // Element editing state (e.g., page frame inline editing)
  private _editingElement: DrawableElement | null = null;
  private _editDomRoot: HTMLElement | null = null;
  private _cleanupEditListeners: (() => void) | null = null;

  // Orthogonal to tools: the next primary-button click finalizes placement and clears the state.
  // The controller owns the ghost + Escape listener; the canvas drives cursor and edit-mode exit.
  private readonly _placement = new PlacementController();

  // Selection / element set / order / edit mode / placement. Viewport pan/zoom has its own channel.
  private _changeListeners = new Set<() => void>();

  // The union only changes on element add/remove/reorder/geometry, never on pan/zoom, so it is
  // lazy and invalidated at every mutation funnel. `_valid` is separate because `null` is itself
  // a valid cached result (empty document).
  private _contentBoundsCache: DOMRect | null = null;
  private _contentBoundsValid = false;

  /** Latest live-session membership; null until the app feeds a snapshot. */
  private _livePeers: LivePeersSnapshot | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    ydoc: YDocManager,
    tools?: ITool[],
    resolveNoteLink?: ResolveNoteLink,
    resolveMedia?: ResolveMediaSrc,
    private readonly _localPeerId = '',
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      logger.error('Failed to get canvas context');
    }

    this.canvas = canvas;
    this.canvas.style.zIndex = '10';
    this.ctx = ctx!;
    this.renderer = new CanvasRenderer(this.ctx, canvas);
    this.viewport = new CanvasViewport(canvas);
    this.viewport.setContentBoundsProvider(() => this.getContentBounds());
    this.viewport.setTouchSuppressedProvider(() => this._palm.suppressed);
    this.state = new StateMachine(InteractState.Idle);
    this.tools = tools ?? DrawableCanvas.makeTools(() => catalogs.en);
    this.toolSelected = this.tools[0];
    this._ydoc = ydoc;
    this.resolveNoteLink = resolveNoteLink;
    this.resolveMedia = resolveMedia;

    this.initEventListeners(canvas);
    this.initStates();

    // Hydrate existing elements from Y.Doc (for loaded documents)
    this.hydrateFromYDoc();
    logger.debug(
      'Hydrated canvas from Y.Doc',
      summarizeDrawableElements(this.elements),
    );

    // Observe element-level changes for undo/redo and remote changes.
    this._ydoc.elements.observeDeep(this._handleYElementsChange);
  }

  public get ydoc(): YDocManager {
    return this._ydoc;
  }

  public get localPeerId(): string {
    return this._localPeerId;
  }

  // Forwarded to elements that coordinate work across peers (audio transcription claims).
  public setLivePeers(snapshot: LivePeersSnapshot | null): void {
    if (this._livePeers === snapshot) {
      return;
    }
    this._livePeers = snapshot;
    for (const element of this.elements) {
      if (element instanceof AudioElement) {
        element.setLivePeers(snapshot);
      }
    }
  }

  // Nested element-map transacts flatten into this one, so a multi-step edit (e.g. the pen's
  // stroke->shape swap) coalesces into one undo item.
  public transact(fn: () => void): void {
    this._ydoc.transact(fn);
  }

  private hydrateFromYDoc(): void {
    for (let i = 0; i < this._ydoc.elements.length; i++) {
      const yMap = this._ydoc.elements.get(i);
      const element = this.createElementFromYMap(yMap);
      if (element) {
        this._store.add(element, yMap, this._store.count());
      }
    }
    this.rebuildElementOrderFromYDoc();
  }

  public onChange(listener: () => void): () => void {
    this._changeListeners.add(listener);
    return () => {
      this._changeListeners.delete(listener);
    };
  }

  private notifyChange(): void {
    this._contentBoundsValid = false;
    for (const listener of this._changeListeners) {
      listener();
    }
  }

  private getElementZOrderValue(
    element: DrawableElement,
    fallback: number,
  ): number {
    const value = element.yMap?.get(ELEMENT_Z_ORDER_KEY);
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private rebuildElementOrderFromYDoc(): void {
    const ordered: Array<{
      element: DrawableElement;
      arrayIndex: number;
      zOrder: number;
    }> = [];

    for (let i = 0; i < this._ydoc.elements.length; i++) {
      const yMap = this._ydoc.elements.get(i);
      const element = this._store.byYMap(yMap);
      if (!element) {
        continue;
      }
      ordered.push({
        element,
        arrayIndex: i,
        zOrder: this.getElementZOrderValue(element, i),
      });
    }

    ordered.sort((a, b) => {
      const layerDelta =
        getElementLayer(a.element.type) - getElementLayer(b.element.type);
      if (layerDelta !== 0) {
        return layerDelta;
      }
      const orderDelta = a.zOrder - b.zOrder;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return a.arrayIndex - b.arrayIndex;
    });

    this._store.setOrder(ordered.map(({ element }) => element.uuid));
  }

  private createElementFromYMap(yMap: Y.Map<unknown>): DrawableElement | null {
    const type = yMap.get('type');
    const uuid = yMap.get('uuid');
    if (typeof type !== 'number' || typeof uuid !== 'string') {
      return null;
    }

    const factory = (
      ELEMENT_FACTORIES as Partial<Record<number, ElementFactory>>
    )[type];
    if (!factory) {
      return null;
    }

    const element = factory(uuid);
    this.configureElement(element);
    element.bindToYMap(yMap);
    this.bindElementSharedYState(element);
    return element;
  }

  private configureElement(element: DrawableElement): void {
    element.onSelectionChanged = () => {
      this.notifyChange();
    };
    element.onTransformChanged = () => {
      // Any element geometry change invalidates the cached content bounds, even
      // for unselected elements (notifyChange only fires for selected ones).
      this._contentBoundsValid = false;
      if (element.isSelected) {
        this.notifyChange();
      }
    };
    if (element instanceof PageFrameElement) {
      element.setNoteLinkResolver(this.resolveNoteLink);
      element.setMediaResolver(this.resolveMedia);
      element.setOnDisplayNameRenamed((uuid, newName, oldName) => {
        this.onPageFrameRenamed?.(uuid, newName, oldName);
      });
      element.setExportElementsProvider(() => this.elements);
    }
    if (element instanceof PdfElement) {
      element.setExportElementsProvider(() => this.elements);
    }
    if (element instanceof AudioElement) {
      element.setLocalPeerId(this._localPeerId);
      element.setLivePeers(this._livePeers);
    }
  }

  public setOnPageFrameRenamed(
    callback?: (uuid: string, newName: string, oldName: string) => void,
  ): void {
    this.onPageFrameRenamed = callback;
  }

  private bindElementSharedYState(element: DrawableElement): void {
    element.bindSharedYState(this._ydoc);
  }

  private handleYElementsChange(
    events: YElementsDeepEvents,
    transaction: YElementsDeepTransaction,
  ): void {
    if (transaction.origin === LOCAL_ORIGIN) {
      return;
    }

    // Remote field syncs bypass notifyChange/onTransformChanged, so invalidate here to keep pan
    // clamping correct after a peer moves an element.
    this._contentBoundsValid = false;

    let changedElementOrder = false;
    const insertedMaps = new Set<Y.Map<unknown>>();

    for (const event of events) {
      if (
        event instanceof Y.YArrayEvent &&
        event.target === this._ydoc.elements
      ) {
        this.collectInsertedMaps(event, insertedMaps);
        this.handleYArrayChange(event as Y.YArrayEvent<Y.Map<unknown>>);
      }
    }

    for (const event of events) {
      if (event instanceof Y.YMapEvent) {
        const yMap = event.target as Y.Map<unknown>;
        if (insertedMaps.has(yMap)) {
          continue;
        }
        if (event.keysChanged.has(ELEMENT_Z_ORDER_KEY)) {
          changedElementOrder = true;
        }
        this.syncElementFromYMapEvent(yMap, event.keysChanged);
        continue;
      }

      if (
        event instanceof Y.YArrayEvent &&
        event.target !== this._ydoc.elements
      ) {
        this.syncElementFromNestedEvent(event);
      }
    }

    if (changedElementOrder) {
      this.rebuildElementOrderFromYDoc();
    }
  }

  private collectInsertedMaps(
    event: Y.YArrayEvent<Y.Map<unknown>>,
    insertedMaps: Set<Y.Map<unknown>>,
  ): void {
    for (const delta of event.changes.delta) {
      if ('insert' in delta) {
        const inserted = delta.insert;
        if (!Array.isArray(inserted)) {
          continue;
        }
        for (const value of inserted) {
          if (value instanceof Y.Map) {
            insertedMaps.add(value as Y.Map<unknown>);
          }
        }
      }
    }
  }

  private syncElementFromYMapEvent(
    yMap: Y.Map<unknown>,
    keysChanged: Set<unknown>,
  ): boolean {
    const element = this._store.byYMap(yMap);
    if (!element) {
      return false;
    }

    const keys = Array.from(keysChanged).filter(
      (key): key is string => typeof key === 'string',
    );
    element.syncFromYMap(keys);
    return keys.length > 0;
  }

  private syncElementFromNestedEvent(event: YElementsDeepEvent): boolean {
    const [elementPosition, fieldKey] = event.path;
    if (typeof elementPosition !== 'number' || typeof fieldKey !== 'string') {
      return false;
    }

    const yMap = this._ydoc.elements.get(elementPosition);
    const element = this._store.byYMap(yMap);
    if (!element) {
      return false;
    }

    element.syncFromYMap([fieldKey]);
    return true;
  }

  private handleYArrayChange(event: Y.YArrayEvent<Y.Map<unknown>>): void {
    let position = 0;
    for (const delta of event.changes.delta) {
      if ('retain' in delta) {
        position += delta.retain!;
      }
      if ('insert' in delta) {
        const inserted = delta.insert as Y.Map<unknown>[];
        for (const yMap of inserted) {
          if (!this._store.byYMap(yMap)) {
            const element = this.createElementFromYMap(yMap);
            if (element) {
              this._store.add(element, yMap, position);
            }
          }
          position++;
        }
      }
    }

    // Handle deletions: drop elements whose Y.Maps are no longer in the array.
    const currentYMaps = new Set<Y.Map<unknown>>();
    for (let i = 0; i < this._ydoc.elements.length; i++) {
      currentYMaps.add(this._ydoc.elements.get(i));
    }
    const removedUuids = new Set<string>();
    for (const element of this._store.all()) {
      if (element.yMap && !currentYMaps.has(element.yMap)) {
        element.disposeDOM();
        removedUuids.add(element.uuid);
      }
    }
    this._store.removeMany(removedUuids);

    this.rebuildElementOrderFromYDoc();
    logger.debug('Applied external canvas element change', {
      origin: String(event.transaction.origin ?? 'unknown'),
      ...summarizeDrawableElements(this.elements),
    });
  }

  // Not a canvas: a repeating CSS background makes panning a compositor translate.
  public setBackgroundHost(host: HTMLElement): void {
    this.renderer.setBackgroundHost(host);
  }

  // Always on top, so selection stays visible above DOM-backed editing chrome.
  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.renderer.setOverlayCanvas(canvas);
  }

  public setDomOverlayHost(host: HTMLElement): void {
    this._domOverlayHost = host;
  }

  public setOnElementEdit(callback: (element: DrawableElement | null) => void) {
    this.onElementEdit = callback;
  }

  public setOnToolSwitched(callback: (index: number) => void) {
    this.onToolSwitched = callback;
  }

  public setOnPlacementEnd(callback: (() => void) | undefined) {
    this._placement.setOnPlacementEnd(callback);
  }

  public get isPlacing(): boolean {
    return this._placement.isActive;
  }

  public startPlacement(ghost: PlacementGhost): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
    if (this._placement.isActive) {
      this.endPlacement();
    }
    this._placement.start(ghost);
    this._toolCursor = 'copy';
    this.updateCursor();
    this.notifyChange();
  }

  public cancelPlacement(): void {
    if (this._placement.isActive) {
      this.endPlacement();
    }
  }

  private endPlacement(): void {
    this._placement.end();
    this._toolCursor = 'default';
    this.updateCursor();
    this.notifyChange();
  }

  public getElementsByType(type: ElementType): DrawableElement[] {
    return this.elements.filter((e) => e.type === type);
  }

  public focusPageFrameByName(displayName: string): boolean {
    const frame = this.elements.find(
      (element): element is PageFrameElement =>
        element instanceof PageFrameElement &&
        element.displayName === displayName,
    );
    return this.focusFrameElement(frame);
  }

  public focusPageFrameById(uuid: string): boolean {
    const frame = this.elements.find(
      (element): element is PageFrameElement =>
        element instanceof PageFrameElement && element.uuid === uuid,
    );
    return this.focusFrameElement(frame);
  }

  private focusFrameElement(frame: PageFrameElement | undefined): boolean {
    if (!frame) {
      return false;
    }

    if (this._editingElement && this._editingElement !== frame) {
      this.exitElementEdit();
    }
    this.clearSelection();
    frame.select();
    this.viewport.animateViewToFitRect(frame.boundingBox, {
      widthRatio: 0.72,
      heightRatio: 0.82,
    });
    return true;
  }

  public get editingElement(): DrawableElement | null {
    return this._editingElement;
  }

  public get isCanvasInteractiveEditMode(): boolean {
    return this._editingElement !== null && this._editDomRoot === null;
  }

  public syncViewportEditModePan(): void {
    const element = this._editingElement;
    const viewportEditMode =
      element !== null &&
      !this.isCanvasInteractiveEditMode &&
      element.locksViewportPanWhileEditing;
    this.viewport.setEditMode(viewportEditMode, {
      panAxis:
        element !== null &&
        'pageLayout' in element &&
        element.pageLayout === 'horizontal'
          ? 'horizontal'
          : 'vertical',
    });
  }

  public enterElementEdit(element: DrawableElement, event?: Event): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }

    // Stop the initiating event from bubbling to the document-level
    // click-outside listener we're about to register.
    event?.stopPropagation();

    this._editingElement = element;
    this.notifyChange();
    logger.debug('Entering canvas element edit mode', {
      uuid: element.uuid,
      type: describeElementType(element.type),
      ...summarizeDrawableElements(this.elements),
    });
    // Click-to-create runs synchronously, so a DOM-backed element can enter edit mode before its
    // first render frame; sync now so enterEditMode has a node to focus.
    if (this._domOverlayHost) {
      element.syncDOM(this.viewport, this._domOverlayHost);
    }

    const pe = event instanceof PointerEvent ? event : undefined;
    const editDomRoot = element.enterEditMode(this, pe?.clientX, pe?.clientY);
    this._editDomRoot = editDomRoot;

    if (editDomRoot) {
      // Canvas stops intercepting pointer events so the DOM editor (chrome
      // contentEditable / inline text input) receives them.
      this.canvas.style.pointerEvents = 'none';
    }

    // Camera switches to edit-mode pan + two-finger touch handling.
    this.syncViewportEditModePan();
    this.onElementEdit?.(element);

    // Escape exits edit mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.exitElementEdit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Click outside editing DOM exits edit mode. Canvas-interactive edit modes
    // handle canvas clicks through the active tool so resize handles still work.
    const handlePointerDown = (e: PointerEvent) => {
      // Lets one gesture both exit edit mode and start the resize, instead of forcing a second click.
      // Canvas-interactive edit modes already route handle clicks through the tool; this covers modes
      // where a DOM editor root has taken over canvas pointer events.
      // The wider touch radius is gated on the select tool because this hands the gesture to whichever
      // tool is active — a finger landing near a handle with the pen tool would draw, not resize.
      if (
        editDomRoot &&
        !editDomRoot.contains(e.target as Node) &&
        element.isSelected &&
        element.hitHandle(
          this.viewport.getPoint(e),
          this.viewport.zoom,
          e.pointerType === 'touch' && this.toolSelected.id === 'select',
        )
      ) {
        this.exitElementEdit();
        this.state.change(InteractState.UsingTool, e);
        return;
      }
      // The selection toolbar can act on the element being edited (e.g. text style controls), so a
      // press there must never tear down edit mode.
      if (
        e.target instanceof Element &&
        e.target.closest('[data-selection-toolbar="true"]')
      ) {
        return;
      }
      if (!editDomRoot && e.target === this.canvas) {
        return;
      }
      if (!editDomRoot?.contains(e.target as Node)) {
        this.exitElementEdit();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);

    // While a DOM editor covers the canvas the tool's hover() no longer runs (pointer-events: none),
    // so mirror the resize cursor here. `cursor` is inherited, so the host shows it under the handle
    // while the textarea keeps its own text cursor.
    const cursorHost = this.canvas.parentElement;
    const handlePointerMove = (e: PointerEvent) => {
      if (!editDomRoot || !cursorHost) {
        return;
      }
      const handle = element.isSelected
        ? element.hitHandle(this.viewport.getPoint(e), this.viewport.zoom)
        : null;
      cursorHost.style.cursor = handle ? handle.cursor : '';
    };
    document.addEventListener('pointermove', handlePointerMove);

    this._cleanupEditListeners = () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointermove', handlePointerMove);
      if (cursorHost) {
        cursorHost.style.cursor = '';
      }
    };
  }

  public exitElementEdit(): void {
    if (!this._editingElement) {
      return;
    }
    this._cleanupEditListeners?.();
    this._cleanupEditListeners = null;
    const element = this._editingElement;
    element.exitEditMode();
    // Yjs captures changes automatically — no command to push
    this._editingElement = null;
    this._editDomRoot = null;
    this.notifyChange();
    this.syncViewportEditModePan();
    this.canvas.style.pointerEvents = '';
    this.onElementEdit?.(null);
    logger.debug('Exited canvas element edit mode', {
      uuid: element.uuid,
      type: describeElementType(element.type),
    });
  }

  public enterEditAtPoint(point: Vector2, event?: Event): boolean {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const element = this.elements[i];
      if (!CollisionHelper.inBox(point, element.boundingBox)) {
        continue;
      }
      if (element.editable) {
        for (const other of this.elements) {
          if (other !== element) {
            other.unselect();
          }
        }
        element.select();
        this.enterElementEdit(element, event);
        return true;
      }
    }
    return false;
  }

  public destroy(): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
    if (this._placement.isActive) {
      this.endPlacement();
    }
    this.renderer.destroy();
    this._ydoc.elements.unobserveDeep(this._handleYElementsChange);
    for (const element of this._store.all()) {
      element.disposeDOM();
    }
    this._store.clear();
    this.viewport.destroy();
    this._input.destroy();
    window.removeEventListener('pointermove', this._handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this._handlePointerDown);
    window.removeEventListener('pointerup', this._handlePointerUp);
    window.removeEventListener('pointercancel', this._handlePointerUp);
    window.removeEventListener('resize', this._handleResize);
  }

  public redraw(deltaTime: number) {
    this.renderer.redraw(
      deltaTime,
      this.viewport,
      this.elements,
      this._editingElement,
      this.toolSelected,
      this.screenPosition,
      this._placement,
      this._domOverlayHost,
    );
  }

  // `null` when empty — the viewport reads that as "no clamp" so fresh documents stay pannable.
  public getContentBounds(): DOMRect | null {
    if (!this._contentBoundsValid) {
      this._contentBoundsCache = unionBoundingBoxes(this.elements);
      this._contentBoundsValid = true;
    }
    return this._contentBoundsCache;
  }

  // Non-hidden elements only, for thumbnail rendering. Empty content -> zero-size DOMRect.
  public get contentBounds(): DOMRect {
    return (
      unionBoundingBoxes(this.elements.filter((e) => !e.hidden)) ??
      new DOMRect(0, 0, 0, 0)
    );
  }

  public get elements(): DrawableElement[] {
    return this._store.getOrdered();
  }

  public getElementByUuid(uuid: string): DrawableElement | null {
    return this._store.byUuid(uuid);
  }

  public getSelectedElements(): DrawableElement[] {
    return this.elements.filter((element) => element.isSelected);
  }

  public getSelectedElementBounds(): DOMRect | null {
    const selected = this.getSelectedElements();
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

  public getSelectedElementScreenBounds(): DOMRect | null {
    const bounds = this.getSelectedElementBounds();
    if (!bounds) {
      return null;
    }

    const topLeft = this.viewport.worldToScreen({
      x: bounds.left,
      y: bounds.top,
    });
    const bottomRight = this.viewport.worldToScreen({
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

  private getElementOrderItems(): ElementOrderItem[] {
    return this.elements.map((element) => ({
      uuid: element.uuid,
      type: element.type,
    }));
  }

  public canReorderSelection(direction: ElementReorderDirection): boolean {
    return canMoveElementOrderForSelection(
      this.getElementOrderItems(),
      this.getSelectedElements().map((element) => element.uuid),
      direction,
    );
  }

  public reorderSelection(direction: ElementReorderDirection): boolean {
    const selectedUuids = this.getSelectedElements().map(
      (element) => element.uuid,
    );
    if (
      !canMoveElementOrderForSelection(
        this.getElementOrderItems(),
        selectedUuids,
        direction,
      )
    ) {
      return false;
    }

    this._store.setOrder(
      moveElementOrderForSelection(
        this.getElementOrderItems(),
        selectedUuids,
        direction,
      ),
    );
    this.persistCurrentElementOrder();
    return true;
  }

  private persistCurrentElementOrder(): void {
    const order = this._store.order();
    this._ydoc.undoManager.stopCapturing();
    this._ydoc.transact(() => {
      for (let i = 0; i < order.length; i++) {
        const yMap = this._store.byUuid(order[i])?.yMap;
        if (!yMap) {
          continue;
        }
        if (yMap.get(ELEMENT_Z_ORDER_KEY) === i) {
          continue;
        }
        yMap.set(ELEMENT_Z_ORDER_KEY, i);
      }
    });
    this._ydoc.undoManager.stopCapturing();
  }

  public clearSelection(): void {
    for (const element of this._store.all()) {
      element.unselect();
    }
  }

  public selectElementsByUuid(uuids: readonly string[]): void {
    this.clearSelection();
    for (const uuid of uuids) {
      this._store.byUuid(uuid)?.select();
    }
  }

  public selectAllElements(): void {
    if (this._editingElement || this._placement.isActive) {
      return;
    }
    for (const element of this._store.all()) {
      element.select();
    }
  }

  private getZOrderForInsertion(position: number, background: boolean): number {
    const layer = background ? 0 : 1;
    const order = this._store.order();
    let before: DrawableElement | null = null;
    let after: DrawableElement | null = null;

    for (let i = position - 1; i >= 0; i--) {
      const element = this._store.byUuid(order[i]);
      if (element && getElementLayer(element.type) === layer) {
        before = element;
        break;
      }
    }
    for (let i = position; i < order.length; i++) {
      const element = this._store.byUuid(order[i]);
      if (element && getElementLayer(element.type) === layer) {
        after = element;
        break;
      }
    }

    if (before && after) {
      return (
        (this.getElementZOrderValue(before, position - 1) +
          this.getElementZOrderValue(after, position)) /
        2
      );
    }
    if (before) {
      return this.getElementZOrderValue(before, position - 1) + 1;
    }
    if (after) {
      return this.getElementZOrderValue(after, position) - 1;
    }
    return position;
  }

  public insertElementMap(
    yMap: Y.Map<unknown>,
    options?: { background?: boolean; position?: number },
  ): DrawableElement | null {
    const background =
      options?.background ??
      isBackgroundElement(
        (yMap.get('type') as ElementType | undefined) ?? ElementType.STROKE,
      );
    const orderLength = this._store.order().length;
    const position = Math.max(
      0,
      Math.min(
        options?.position ?? (background ? 0 : orderLength),
        orderLength,
      ),
    );

    yMap.set(
      ELEMENT_Z_ORDER_KEY,
      this.getZOrderForInsertion(position, background),
    );
    this._ydoc.insertExistingElementMap(position, yMap);

    const element = this.createElementFromYMap(yMap);
    if (!element) {
      this._ydoc.removeElementMap(yMap);
      return null;
    }

    this._store.add(element, yMap, position);
    return element;
  }

  private initStates() {
    this.state.addEnd(InteractState.UsingTool, (event) => {
      if (this._abortingInteraction) {
        if (this.toolSelected.abort) {
          this.toolSelected.abort(this);
        } else {
          this.toolSelected.interrupt(this);
        }
      } else {
        this.toolSelected.finish(this, event);
      }
      this._ydoc.undoManager.stopCapturing();
    });

    this.state.addStart(InteractState.UsingTool, (event) => {
      this._ydoc.undoManager.stopCapturing();
      this._lastToolSampleTime = event.timeStamp;
      this.toolSelected.start(this, event);
    });

    this.state.addUpdate(InteractState.UsingTool, (event: PointerEvent) => {
      const samples = coalescedPointerSamples(event, this._lastToolSampleTime);
      this._lastToolSampleTime = event.timeStamp;
      for (const sample of samples) {
        this.toolSelected.update(this, sample, this.viewport.getPoint(sample));
      }
    });

    this.state.addStart(InteractState.Moving, () => {
      this.updateCursor();
    });

    this.state.addEnd(InteractState.Moving, () => {
      this.updateCursor();
    });

    this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
      this.viewport.panBy(
        event.movementX / this.viewport.zoom,
        event.movementY / this.viewport.zoom,
      );
    });
  }

  // True for a resize handle of a selected element, or a body that grabs (see
  // `DrawableElement.grabsFromBody`). Otherwise the finger pans.
  private touchGrabsElement(point: Vector2): boolean {
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const element = this.elements[i];
      if (
        element.isSelected &&
        element.hitHandle(point, this.viewport.zoom, true)
      ) {
        return true;
      }
    }
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const element = this.elements[i];
      if (!CollisionHelper.inBox(point, element.boundingBox)) {
        continue;
      }
      if (element.grabsFromBody) {
        return true;
      }
    }
    return false;
  }

  private initEventListeners(canvas: HTMLCanvasElement) {
    // On the window, not the canvas: DOM layered above the canvas (page-frame chrome, world-anchored
    // links) swallows pointermove, freezing an in-progress drag until the cursor left that DOM again.
    this._handlePointerMove = (evt) => {
      this._input.observe(evt);
      // A rejected palm still emits moves, and this handler feeds them to the active tool regardless
      // of which pointer opened the interaction — so the palm would draw into the pen's own stroke.
      if (this._palm.isKnownPalm(evt.pointerId)) {
        return;
      }
      // Before the update, so a barrel pressed mid-gesture hands the rest of it to the tool that
      // just took over. Android never gets here: StylusEventRewriter.kt pins a contact's tool type
      // at touchdown.
      this.syncEraserOverride(evt);
      this.syncPenChordedContact(evt);
      this.screenPosition = this.viewport.getScreenPoint(evt);
      this.state.update(evt);
      if (evt.target === canvas) {
        const mouseWorld = this.viewport.screenToWorld(this.screenPosition);
        this.toolSelected.hover?.(this, mouseWorld);
      }
      this.updateCursor();
    };
    window.addEventListener('pointermove', this._handlePointerMove);

    this._handlePointerDown = (evt) => {
      this._input.observe(evt);
      // One-shot placement intercepts primary-button clicks regardless of tool.
      if (this._placement.isActive) {
        if (evt.button === 0) {
          const worldPos = this.viewport.getPoint(evt);
          this._placement.ghost?.onPlace(worldPos);
        }
        this.endPlacement();
        return;
      }

      switch (evt.pointerType) {
        case 'touch': {
          if (this._palm.isPalm(evt.pointerId)) {
            break;
          }
          this._activeTouchPointers.add(evt.pointerId);
          // Second finger down → the viewport owns the pinch/pan gesture; stop
          // any single-finger pan in progress and ignore this pointer.
          if (this._activeTouchPointers.size >= 2) {
            this._touchTapCandidate = null;
            // The two fingers of a pinch never land together, so in touch mode the first has already begun
            // a stroke. Discard it rather than commit it.
            if (this._input.touchDrivesTool) {
              this.abortInteraction();
            }
            this.state.change(InteractState.Idle, evt);
            break;
          }
          // In touch mode a finger is the brush, so it goes ahead of the double-tap and pan gestures,
          // which would eat the start of a stroke — or, with select, of a marquee. The tool runs its
          // own double-tap and hit tests from there.
          if (this._input.touchDrivesTool) {
            this._touchTapCandidate = null;
            this.state.change(InteractState.UsingTool, evt);
            this.state.update(evt);
            break;
          }
          // Double-tap enters element edit (matches the mouse/pen double-click);
          // otherwise a single finger pans the canvas.
          const point = this.viewport.getPoint(evt);
          const now = Date.now();
          const dx = point.x - this._lastTouchTapPos.x;
          const dy = point.y - this._lastTouchTapPos.y;
          const isDoubleTap =
            now - this._lastTouchTapTime < 400 && dx * dx + dy * dy < 25;
          if (isDoubleTap && this.enterEditAtPoint(point, evt)) {
            this._lastTouchTapTime = 0;
            break;
          }
          this._lastTouchTapTime = now;
          this._lastTouchTapPos = point;

          // With the select tool, a finger on something already grabbable
          // drives the tool, so touch moves and resizes like the pen does.
          const selecting = this.toolSelected.id === 'select';
          if (selecting && this.touchGrabsElement(point)) {
            this._touchTapCandidate = null;
            this.state.change(InteractState.UsingTool, evt);
            this.state.update(evt);
            break;
          }
          // Everything else keeps panning with one finger; pointerup replays
          // the gesture through the tool if it turned out to be a tap.
          this._touchTapCandidate = selecting
            ? { x: evt.clientX, y: evt.clientY }
            : null;
          this.state.change(InteractState.Moving, evt);
          this.state.update(evt);
          break;
        }
        case 'pen':
          // A second barrel button opens the tool wheel (the app layer listens for it) and must
          // not also lay down a mark.
          if (evt.buttons & PEN_WHEEL_BUTTONS) {
            break;
          }
          this.syncEraserOverride(evt);
          // A button pressed while the pen hovers fires a pointerdown of its own, but nothing is
          // touching the glass, so no tool may run. The override above still applies, so the ring
          // previews where the eraser would bite.
          if (!(evt.buttons & PEN_CONTACT_BUTTONS)) {
            break;
          }
          this._penContactOpen = true;
          this.beginPenContact(evt);
          this.state.change(InteractState.UsingTool, evt);
          this.state.update(evt);
          break;

        // @ts-expect-error
        // biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional fallthrough to default
        case 'mouse':
          if (this.spaceDown || evt.button === 1) {
            this.state.change(InteractState.Moving, evt);
            this.state.update(evt);
            break;
          }

          if (evt.button === 2) {
            break;
          }
        // fallthrough
        default:
          this.state.change(InteractState.UsingTool, evt);
          this.state.update(evt);
          break;
      }
    };
    canvas.addEventListener('pointerdown', this._handlePointerDown);

    this._handlePointerUp = (evt) => {
      this._activeTouchPointers.delete(evt.pointerId);
      // A palm drove nothing, so its lift must end nothing: this window handler would otherwise finish
      // the stylus's live stroke the moment the hand shifted.
      if (this._palm.pointerUp(evt.pointerId, evt.pointerType === 'pen')) {
        return;
      }
      // A finger that lifts without dragging is a tap: run it through the select tool. Dragging pans
      // instead and never reaches this.
      const tap = this._touchTapCandidate;
      this._touchTapCandidate = null;
      if (
        tap &&
        evt.type === 'pointerup' &&
        evt.pointerType === 'touch' &&
        this.state.current === InteractState.Moving &&
        Math.hypot(evt.clientX - tap.x, evt.clientY - tap.y) <= TOUCH_TAP_SLOP
      ) {
        this.state.change(InteractState.UsingTool, evt);
      }
      this.state.change(InteractState.Idle, evt);
      if (evt.pointerType === 'pen') {
        this._penContactOpen = false;
      }
      // After the interaction ends, so the eraser gets to finish its own. A
      // barrel still held as the tip lifts keeps erasing into the next stroke.
      this.syncEraserOverride(evt);
    };
    window.addEventListener('pointerup', this._handlePointerUp);
    // iOS fires pointercancel, not pointerup, for touches it absorbs into a system gesture; without
    // this the active-touch set leaks and blocks future single-finger panning.
    window.addEventListener('pointercancel', this._handlePointerUp);

    this._handleResize = () => {
      this.renderer.refreshSize();
    };
    window.addEventListener('resize', this._handleResize);
  }

  // The factory receives a freshly generated uuid.
  public addElement<T extends DrawableElement>(
    factory: (uuid: string) => T,
    positionOverride?: number,
  ): T {
    const uuid = crypto.randomUUID();
    const element = factory(uuid);
    this.configureElement(element);

    // Build the Y.Map properties from the element's current state
    const background = isBackgroundElement(element.type);
    const defaultPosition = background ? 0 : this._store.order().length;
    const requestedPosition = background
      ? defaultPosition
      : (positionOverride ?? defaultPosition);
    const position = Math.max(
      0,
      Math.min(requestedPosition, this._store.order().length),
    );
    const props: Record<string, unknown> = {
      offsetX: element.offset.x,
      offsetY: element.offset.y,
      scaleX: element.scale.x,
      scaleY: element.scale.y,
      [ELEMENT_Z_ORDER_KEY]: this.getZOrderForInsertion(position, background),
      ...element.getYMapProps(),
    };

    // Create Y.Map and add to array (backgrounds go first so other elements
    // render on top of them).
    let yMap: Y.Map<unknown>;
    if (background) {
      yMap = this._ydoc.insertElementMap(0, element.type, uuid, props);
    } else {
      yMap = this._ydoc.createElementMap(element.type, uuid, props);
    }

    element.bindToYMap(yMap);
    this.bindElementSharedYState(element);
    this._store.add(element, yMap, position);

    logger.debug('Added canvas element', {
      uuid: element.uuid,
      type: describeElementType(element.type),
      ...summarizeDrawableElements(this.elements),
    });

    return element;
  }

  public removeElement(element: DrawableElement) {
    const yMap = element.yMap;
    if (yMap) {
      this._ydoc.removeElementMap(yMap);
    }
    this._store.remove(element.uuid);
    element.disposeDOM();
    logger.debug('Removed canvas element', {
      uuid: element.uuid,
      type: describeElementType(element.type),
      ...summarizeDrawableElements(this.elements),
    });
  }

  public deleteSelected() {
    if (this._editingElement) {
      return;
    }
    const selected: DrawableElement[] = [];
    for (const element of this._store.all()) {
      if (element.isSelected) {
        selected.push(element);
      }
    }
    if (selected.length === 0) {
      return;
    }
    this._ydoc.transact(() => {
      for (const e of selected) {
        e.unselect();
        const yMap = e.yMap;
        if (yMap) {
          this._ydoc.removeElementMap(yMap);
        }
      }
    });
    const removedUuids = new Set<string>();
    for (const e of selected) {
      e.disposeDOM();
      removedUuids.add(e.uuid);
    }
    this._store.removeMany(removedUuids);
    logger.debug('Deleted selected canvas elements', {
      deletedElements: selected.map((element) => ({
        uuid: element.uuid,
        type: describeElementType(element.type),
      })),
      ...summarizeDrawableElements(this.elements),
    });
  }

  public setCursor(cursor: string) {
    this._toolCursor = cursor;
  }

  private updateCursor() {
    let cursor: string;
    if (this.state.current === InteractState.Moving) {
      cursor = 'grabbing';
    } else if (this.spaceDown) {
      cursor = 'grab';
    } else {
      cursor = this._toolCursor;
    }
    // Every pointermove reaches here — 120 a second from a stylus — and
    // assigning an identical value still invalidates the element's style.
    if (cursor !== this._appliedCursor) {
      this._appliedCursor = cursor;
      this.canvas.style.cursor = cursor;
    }
  }

  // PalmRejection reclassifies the touches already on screen; the gesture they had started still
  // has to be unwound here, since the pen typically lands just after the hand does.
  private beginPenContact(evt: PointerEvent) {
    this._palm.penDown(evt.pointerId, this._activeTouchPointers);
    if (this._activeTouchPointers.size > 0) {
      this._activeTouchPointers.clear();
      this._touchTapCandidate = null;
      this.abortInteraction();
      this.state.change(InteractState.Idle, evt);
    }
  }

  /** Whether the pen's barrel or eraser end is currently forcing the eraser. */
  public get penIsErasing(): boolean {
    return this._eraserButtonsHeld;
  }

  /**
   * Open and close a pen contact that a held button hid.
   *
   * With a barrel already down, the tip landing takes `buttons` from 2 to 3 — a chorded transition
   * fires `pointermove`, not `pointerdown` — and lifting the tip with the button still held fires a
   * move rather than a `pointerup`. Neither edge reaches the handlers that open and close a contact.
   */
  private syncPenChordedContact(evt: PointerEvent) {
    if (evt.pointerType !== 'pen') {
      return;
    }
    const contact = (evt.buttons & PEN_CONTACT_BUTTONS) !== 0;
    if (contact === this._penContactOpen) {
      return;
    }
    if (contact) {
      if (this.state.current !== InteractState.Idle) {
        return;
      }
      this._penContactOpen = true;
      this.beginPenContact(evt);
      this.state.change(InteractState.UsingTool, evt);
      return;
    }
    this._penContactOpen = false;
    this.state.change(InteractState.Idle, evt);
    this._palm.pointerUp(evt.pointerId, true);
  }

  /**
   * Track the erase-while-held buttons across every pen event.
   *
   * `button` names only the button that changed, and is absent when it was already held as the tip
   * landed — the ordinary way an S Pen is used. `buttons` carries the held state on every event,
   * hover included, so both edges are visible wherever they happen.
   */
  private syncEraserOverride(evt: PointerEvent) {
    if (evt.pointerType !== 'pen') {
      return;
    }
    const held = (evt.buttons & PEN_ERASER_BUTTONS) !== 0;
    if (held === this._eraserButtonsHeld) {
      return;
    }
    this._eraserButtonsHeld = held;
    // Swapping the tool mid-interaction would hand the new one an interaction the old one opened.
    const inFlight = this.state.current === InteractState.UsingTool;
    if (inFlight) {
      this.state.change(InteractState.Idle, evt);
    }
    if (held) {
      this.beginEraserOverride();
    } else {
      this.endEraserOverride();
    }
    if (inFlight && evt.buttons & PEN_CONTACT_BUTTONS) {
      this.state.change(InteractState.UsingTool, evt);
    }
  }

  // Deliberately not `switchTool`: erasing this way shouldn't clear the selection or move the
  // toolbar highlight, and the on-canvas eraser ring is feedback enough.
  private beginEraserOverride() {
    const eraser = this.tools.find((t) => t.id === 'eraser');
    if (!eraser || this._eraserOverride || this.toolSelected === eraser) {
      return;
    }
    this._eraserOverride = this.toolSelected;
    this.toolSelected = eraser;
  }

  private endEraserOverride() {
    if (this._eraserOverride) {
      this.toolSelected = this._eraserOverride;
      this._eraserOverride = null;
    }
  }

  // Used when a gesture that started as tool use turns out to be something else — a pen resting
  // on the canvas to summon the tool wheel.
  public abortInteraction() {
    if (this.state.current !== InteractState.UsingTool) {
      return;
    }
    this._abortingInteraction = true;
    this.state.change(InteractState.Idle, null);
    this._abortingInteraction = false;
  }

  // Only a plain one-finger pan is the app layer's to take: a palm under the stylus is not input
  // at all, and a finger that grabbed an element is mid-drag.
  public releaseTouchForToolWheel(): boolean {
    if (this._palm.suppressed || this.state.current !== InteractState.Moving) {
      return false;
    }
    this._touchTapCandidate = null;
    this.state.change(InteractState.Idle, null);
    return true;
  }

  public switchTool(to: number) {
    // An explicit switch wins over a live eraser-end override, or lifting the
    // stylus would silently restore the tool the user just switched away from.
    // The held flag goes with it: left set, the button's next edge would look
    // like no change at all and the override could never re-engage.
    this._eraserOverride = null;
    this._eraserButtonsHeld = false;
    this.toolSelected.interrupt(this);
    const next = this.tools[to];
    // A tool that pushes options onto the selection (the text tool) needs it to survive the switch,
    // or its options panel has nothing to act on. Every other tool starts clean.
    if (!next.applyOptionToSelection) {
      for (const e of this._store.all()) {
        e.unselect();
      }
    }
    this.toolSelected = next;
    this._toolCursor = 'default';
    this.updateCursor();
    this.onToolSwitched?.(to);
  }

  /** Switch to a tool by id, for tools that hand control back by name. */
  public switchToTool(id: ToolId) {
    const index = this.tools.findIndex((t) => t.id === id);
    if (index >= 0) {
      this.switchTool(index);
    }
  }

  public setSpaceDown(value: boolean) {
    this.spaceDown = value;
    this.updateCursor();
  }

  public undo() {
    this._ydoc.undoManager.undo();
  }

  public redo() {
    this._ydoc.undoManager.redo();
  }

  public static makeTools(getStrings: MessageGetter): ITool[] {
    return [
      new SelectTool(getStrings),
      new PenTool(getStrings),
      new HighlighterTool(getStrings),
      new EraserTool(getStrings),
      new TextTool(getStrings),
    ];
  }
}

enum InteractState {
  UsingTool = 0,
  Moving,
  Idle,
}
