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

/**
 * PointerEvent.buttons bits that put the stylus into erase mode for as long as
 * they are held: the eraser end (Pointer Events L3, set when the tail is
 * flipped down) and the primary barrel button, which on an S Pen is the only
 * one there is. No Apple Pencil reports either.
 */
const PEN_ERASER_BUTTONS = 32 | 2;

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

/**
 * Every stylus sample behind a `pointermove`, oldest first.
 *
 * A stylus samples far faster than the display refreshes, so the platform
 * batches the samples taken since the last frame into a single pointermove and
 * exposes them as coalesced events. Reading only the delivered event keeps the
 * newest sample and discards the rest, drawing a straight chord across the
 * batch — the flat segments that show up in handwriting whenever a frame runs
 * long. Falls back to the event itself where coalescing is unsupported.
 */
export function coalescedPointerSamples(event: PointerEvent): PointerEvent[] {
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

  // Touch double-tap → element edit. A single finger that starts a pan never
  // reaches the select tool's double-click path, so we detect the double-tap
  // here instead.
  private _lastTouchTapTime: number = 0;
  private _lastTouchTapPos: Vector2 = { x: 0, y: 0 };

  // Screen position of a single finger that began panning with the select
  // tool active. If it lifts without dragging, the gesture was a tap and is
  // replayed through the tool so it can select / clear the selection.
  private _touchTapCandidate: Vector2 | null = null;

  // Active touch pointers by id. A two-finger touch is a viewport pinch/pan
  // gesture (handled by CanvasViewport's touch listeners), so single-finger
  // pointer panning must yield while 2+ fingers are down.
  private readonly _activeTouchPointers = new Set<number>();

  // Set for the duration of abortInteraction() so the UsingTool end handler
  // discards the interaction instead of committing it.
  private _abortingInteraction: boolean = false;

  // The tool to hand back when the eraser end or barrel button lifts, and the
  // held state that decides it — see syncEraserOverride.
  private _eraserOverride: ITool | null = null;
  private _eraserButtonsHeld: boolean = false;

  // While the stylus is on the glass — and briefly after — a hand resting on
  // the screen must drive nothing.
  private readonly _palm = new PalmRejection();

  // Whether a finger draws or pans — see InputModeController.
  private readonly _input = new InputModeController();

  /** Owns the element collections and keeps them mutating as a unit. */
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

  // One-shot placement state — orthogonal to tools. When active, the next
  // primary-button click finalizes placement and the state clears. The
  // controller owns the ghost + Escape listener; the canvas drives lifecycle
  // (cursor, edit-mode exit, change notification).
  private readonly _placement = new PlacementController();

  /**
   * Listeners notified when selection, element set, element order, edit mode,
   * or placement state changes — anything that affects view layers like the
   * selection reorder toolbar. Viewport pan/zoom uses a separate channel on
   * CanvasViewport.
   */
  private _changeListeners = new Set<() => void>();

  /**
   * Cached union of element world-space bounding boxes for `getContentBounds`,
   * which the viewport queries on every pan/zoom frame to clamp the offset. The
   * union only changes when elements are added/removed/reordered or an element's
   * geometry changes, never when the viewport merely pans/zooms, so it is
   * recomputed lazily and invalidated at every mutation funnel. `_valid` is
   * separate because `null` is itself a valid cached result (empty document).
   */
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

  /**
   * Latest live-session membership from the app's sync layer. Forwarded to
   * elements that coordinate work across peers (audio transcription claims).
   */
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

  /**
   * Run a mutation inside a single Yjs transaction. Nested element-map
   * transacts flatten into this one, so a multi-step edit (e.g. the pen's
   * stroke→shape swap) coalesces into one undo-stack item.
   */
  public transact(fn: () => void): void {
    this._ydoc.transact(fn);
  }

  /**
   * Populate the element store from the current Y.Array state.
   * Called once on construction for loaded documents.
   */
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

  /**
   * Create a DrawableElement from a Y.Map, bind it, and return it.
   */
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

  /** Apply remote element-array and nested element-field changes. */
  private handleYElementsChange(
    events: YElementsDeepEvents,
    transaction: YElementsDeepTransaction,
  ): void {
    if (transaction.origin === LOCAL_ORIGIN) {
      return;
    }

    // Remote field syncs update element geometry without going through
    // notifyChange or onTransformChanged, so invalidate the content-bounds cache
    // here to keep pan clamping correct after a peer moves an element.
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

  /**
   * Element that shows the canvas background (grid / dots). Not a canvas: it
   * carries a repeating CSS background so panning is a compositor translate.
   */
  public setBackgroundHost(host: HTMLElement): void {
    this.renderer.setBackgroundHost(host);
  }

  /**
   * Always-on-top canvas used to render selection outline + handles, so they
   * remain visible above DOM-backed editing chrome.
   */
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
    // DOM-backed elements can enter edit mode before their first render frame
    // (click-to-create runs synchronously); sync now so enterEditMode has an
    // up-to-date node to focus.
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
      // A pointerdown on a resize handle of a DOM-edited element (e.g. a text
      // box) exits edit mode AND begins the resize in the same gesture, rather
      // than only dropping out of edit mode and forcing a second click on the
      // handle. Canvas-interactive edit modes already route handle clicks
      // through the tool; this covers modes where a DOM editor root has taken
      // over canvas pointer events.
      // The wider touch radius is gated on the select tool because this hands
      // the gesture to whichever tool is active: a finger that lands near a
      // handle with, say, the pen tool would start drawing rather than resize,
      // so every other tool keeps the tighter mouse radius.
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
      // The selection toolbar can act on the element currently being edited
      // (e.g. the text style controls), so a press there must never tear down
      // edit mode — including for elements that own a DOM edit root.
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

    // While a DOM editor covers the canvas, the tool's hover() no longer runs
    // (the canvas has pointer-events: none), so the resize cursor over a handle
    // is lost. Mirror it here. `cursor` is inherited, so setting it on the
    // canvas host makes the background canvas under the handle show it, while
    // the textarea keeps its own text cursor inside the box.
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

  /**
   * Hit-test the topmost editable element under a world point and enter its
   * edit mode, selecting it exclusively. Shared by the select tool's
   * double-click path and the touch double-tap path. Returns whether an
   * editable element was found.
   */
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

  /**
   * Union of element world-space bounding boxes. `null` when empty — viewport
   * treats that as "no clamp" so fresh documents stay fully pannable.
   */
  public getContentBounds(): DOMRect | null {
    if (!this._contentBoundsValid) {
      this._contentBoundsCache = unionBoundingBoxes(this.elements);
      this._contentBoundsValid = true;
    }
    return this._contentBoundsCache;
  }

  /**
   * Union of non-hidden element bounding boxes, for thumbnail rendering.
   * Empty content -> a zero-size DOMRect.
   */
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
      this.toolSelected.start(this, event);
    });

    this.state.addUpdate(InteractState.UsingTool, (event: PointerEvent) => {
      for (const sample of coalescedPointerSamples(event)) {
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

  /**
   * Whether a single finger at this world point should drive the select tool
   * instead of panning: a resize handle of a selected element, or a body that
   * grabs (see `DrawableElement.grabsFromBody` — a finger inside an unselected
   * backdrop pans until that backdrop is selected).
   */
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
    // Bound to the window, not the canvas: DOM layered above the canvas
    // (page-frame chrome, the site's world-anchored links) swallows
    // pointermove, which froze an in-progress drag at the last point the
    // canvas heard about until the cursor left that DOM again. Hover still
    // only fires for the bare canvas.
    this._handlePointerMove = (evt) => {
      this._input.observe(evt);
      // A rejected palm still emits moves, and this handler feeds them to the
      // active tool regardless of which pointer opened the interaction — so
      // without this the palm would draw into the pen's own stroke.
      if (this._palm.isKnownPalm(evt.pointerId)) {
        return;
      }
      // Before the update, so a barrel pressed or released part-way through a
      // gesture hands the rest of it to the tool that just took over.
      this.syncEraserOverride(evt);
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
            // The two fingers of a pinch never land together, so in touch mode
            // the first one has already begun a stroke. That mark is not what
            // the user asked for: discard it rather than commit it.
            if (this._input.touchDrivesTool(this.toolSelected.id)) {
              this.abortInteraction();
            }
            this.state.change(InteractState.Idle, evt);
            break;
          }
          // In touch mode a finger is the brush, so it goes straight to the
          // tool — ahead of the double-tap and pan gestures, which would eat
          // the start of a stroke.
          if (this._input.touchDrivesTool(this.toolSelected.id)) {
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
          // A second barrel button opens the tool wheel (the app layer listens
          // for it) and must not also lay down a mark, the same way a
          // right-click doesn't.
          if (evt.buttons & PEN_WHEEL_BUTTONS) {
            break;
          }
          this.syncEraserOverride(evt);
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
      // A palm drove nothing, so its lift must end nothing: this handler is on
      // the window and would otherwise finish the stylus's live stroke the
      // moment the hand shifted.
      if (this._palm.pointerUp(evt.pointerId)) {
        return;
      }
      // A finger that lifts without dragging is a tap: run it through the
      // select tool so it selects what's under it, or clears the selection on
      // empty canvas. Dragging pans instead, and never reaches this.
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
      // After the interaction ends, so the eraser gets to finish its own. A
      // barrel still held as the tip lifts keeps erasing into the next stroke.
      this.syncEraserOverride(evt);
    };
    window.addEventListener('pointerup', this._handlePointerUp);
    // iOS fires pointercancel (not pointerup) for touches it absorbs into a
    // system gesture; without this the active-touch set would leak and block
    // future single-finger panning.
    window.addEventListener('pointercancel', this._handlePointerUp);

    this._handleResize = () => {
      this.renderer.refreshSize();
    };
    window.addEventListener('resize', this._handleResize);
  }

  /**
   * Add a new element to the canvas. The factory receives a freshly generated
   * uuid. The element is created locally, bound to a new Y.Map, and added to
   * the Y.Array.
   */
  public addElement<T extends DrawableElement>(
    factory: (uuid: string) => T,
  ): T {
    const uuid = crypto.randomUUID();
    const element = factory(uuid);
    this.configureElement(element);

    // Build the Y.Map properties from the element's current state
    const background = isBackgroundElement(element.type);
    const position = background ? 0 : this._store.order().length;
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

    // Bind element to its Y.Map
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

  /**
   * The stylus has touched down. PalmRejection reclassifies the touches that
   * were already on the screen; the gesture they had started still has to be
   * unwound here, since the pen typically lands just after the hand does.
   */
  private beginPenContact(evt: PointerEvent) {
    this._palm.penDown(evt.pointerId, this._activeTouchPointers);
    if (this._activeTouchPointers.size > 0) {
      this._activeTouchPointers.clear();
      this._touchTapCandidate = null;
      this.abortInteraction();
      this.state.change(InteractState.Idle, evt);
    }
  }

  /**
   * Track the erase-while-held buttons across every pen event.
   *
   * `button` names only the button that changed on that one event, and is
   * absent when the button was already held as the tip landed — the ordinary
   * way an S Pen is used. `buttons` carries the held state on every event
   * instead, hover included, so both edges are visible wherever they happen.
   */
  /** The tool actually receiving input, eraser override included. */
  public get activeToolId(): string {
    return this.toolSelected.id;
  }

  /** Whether that tool is a temporary override rather than the chosen one. */
  public get toolIsOverridden(): boolean {
    return this._eraserOverride !== null;
  }

  private syncEraserOverride(evt: PointerEvent) {
    if (evt.pointerType !== 'pen') {
      return;
    }
    const held = (evt.buttons & PEN_ERASER_BUTTONS) !== 0;
    if (held === this._eraserButtonsHeld) {
      return;
    }
    this._eraserButtonsHeld = held;
    // Swapping the tool mid-interaction would hand the new one an interaction
    // the old one opened, so what is in flight is committed first and the rest
    // of the contact reopened under the tool that just took over.
    const inFlight = this.state.current === InteractState.UsingTool;
    if (inFlight) {
      this.state.change(InteractState.Idle, evt);
    }
    if (held) {
      this.beginEraserOverride();
    } else {
      this.endEraserOverride();
    }
    if (inFlight && evt.buttons & 1) {
      this.state.change(InteractState.UsingTool, evt);
    }
  }

  /**
   * Swap in the eraser for as long as the barrel or eraser end is held.
   * Deliberately not `switchTool`: erasing this way shouldn't clear the
   * selection or move the toolbar's highlight, and the on-canvas eraser ring
   * is feedback enough.
   */
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

  /**
   * Drop the in-progress tool interaction without committing it. Used when a
   * pointer gesture that started as tool use turns out to be something else —
   * a pen resting on the canvas to summon the tool wheel.
   */
  public abortInteraction() {
    if (this.state.current !== InteractState.UsingTool) {
      return;
    }
    this._abortingInteraction = true;
    this.state.change(InteractState.Idle, null);
    this._abortingInteraction = false;
  }

  /**
   * Give up what a resting finger was doing so the tool wheel can take the
   * gesture over, and report whether it was the app layer's to take.
   *
   * Only a plain one-finger pan is: a palm under the stylus is not input at
   * all, and a finger that grabbed an element is mid-drag, which a long press
   * must not turn into a tool switch.
   */
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
    this._eraserOverride = null;
    this.toolSelected.interrupt(this);
    const next = this.tools[to];
    // A tool that can push its options onto the selection (the text tool) needs
    // that selection to survive the switch, or its options panel has nothing to
    // act on and picking it up is a dead end. Every other tool starts clean, so
    // a stale outline doesn't linger while drawing or erasing.
    if (!next.applyOptionToSelection) {
      for (const e of this._store.all()) {
        e.unselect();
      }
    }
    this.toolSelected = next;
    this._toolCursor = 'default';
    this.updateCursor();
    // Single sync point: every tool switch notifies React so the toolbar
    // selection follows, whether triggered by the UI, a keybind, or a tool
    // handing control back (e.g. the text tool reverting to select).
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
