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
import { ElementType } from './elements/element-type';
import { PageFrameElement } from './elements/page-frame-element';
import { PdfElement } from './elements/pdf-element';
import type { Vector2 } from './geometry';
import { catalogs, type MessageGetter } from './i18n/messages';
import {
  describeElementType,
  summarizeDrawableElements,
} from './note/state-summary';
import type { ResolveMediaSrc } from './page-frame/pm/embed/renderer';
import type { ResolveNoteLink } from './page-frame/pm/markdown/note-links';
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

function isBackgroundElement(type: ElementType): boolean {
  return type === ElementType.PAGE_FRAME || type === ElementType.PDF;
}

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

  // Touch double-tap → element edit. A single finger pans (Moving state), which
  // never runs the select tool, so its double-click edit path can't fire on
  // touch; we detect the double-tap here instead.
  private _lastTouchTapTime: number = 0;
  private _lastTouchTapPos: Vector2 = { x: 0, y: 0 };

  // Active touch pointers by id. A two-finger touch is a viewport pinch/pan
  // gesture (handled by CanvasViewport's touch listeners), so single-finger
  // pointer panning must yield while 2+ fingers are down.
  private readonly _activeTouchPointers = new Set<number>();

  /** Owns the element collections and keeps them mutating as a unit. */
  private readonly _store = new ElementStore(() => this.notifyChange());
  private _ydoc: YDocManager;
  private _domOverlayHost: HTMLElement | null = null;
  private _toolCursor: string = 'default';
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

  public setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.renderer.setBackgroundCanvas(canvas);
  }

  /**
   * Always-on-top canvas used to render selection outline + handles, so they
   * remain visible above DOM-backed editing chrome (where the main canvas is
   * lowered to z=2 to avoid strokes bleeding onto edited text).
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
      // For elements with DOM-backed editing chrome, drop the
      // foreground canvas below the chrome so strokes don't bleed onto the
      // editing surface. The selection outline lives on a separate overlay
      // canvas (z=12) so it stays visible above chrome.
      if (element.lowersCanvasWhileEditing) {
        this.canvas.style.zIndex = '2';
      }
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
      if (
        editDomRoot &&
        !editDomRoot.contains(e.target as Node) &&
        element.isSelected &&
        element.hitHandle(this.viewport.getPoint(e), this.viewport.zoom)
      ) {
        this.exitElementEdit();
        this.state.change(InteractState.UsingTool, e);
        return;
      }
      if (!editDomRoot) {
        if (e.target === this.canvas) {
          return;
        }
        if (
          e.target instanceof Element &&
          e.target.closest('[data-selection-toolbar="true"]')
        ) {
          return;
        }
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
    this.canvas.style.zIndex = '10';
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
    this.canvas.removeEventListener('pointermove', this._handlePointerMove);
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
      this.toolSelected.finish(this, event);
      this._ydoc.undoManager.stopCapturing();
    });

    this.state.addStart(InteractState.UsingTool, (event) => {
      this._ydoc.undoManager.stopCapturing();
      this.toolSelected.start(this, event);
    });

    this.state.addUpdate(InteractState.UsingTool, (event: PointerEvent) => {
      this.toolSelected.update(this, event, this.viewport.getPoint(event));
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

  private initEventListeners(canvas: HTMLCanvasElement) {
    this._handlePointerMove = (evt) => {
      this.screenPosition = this.viewport.getScreenPoint(evt);
      this.state.update(evt);
      const mouseWorld = this.viewport.screenToWorld(this.screenPosition);
      this.toolSelected.hover?.(this, mouseWorld);
      this.updateCursor();
    };
    canvas.addEventListener('pointermove', this._handlePointerMove);

    this._handlePointerDown = (evt) => {
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
          this._activeTouchPointers.add(evt.pointerId);
          // Second finger down → the viewport owns the pinch/pan gesture; stop
          // any single-finger pan in progress and ignore this pointer.
          if (this._activeTouchPointers.size >= 2) {
            this.state.change(InteractState.Idle, evt);
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
          this.state.change(InteractState.Moving, evt);
          this.state.update(evt);
          break;
        }
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
      this.state.change(InteractState.Idle, evt);
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
    if (this.state.current === InteractState.Moving) {
      this.canvas.style.cursor = 'grabbing';
    } else if (this.spaceDown) {
      this.canvas.style.cursor = 'grab';
    } else {
      this.canvas.style.cursor = this._toolCursor;
    }
  }

  public switchTool(to: number) {
    this.toolSelected.interrupt(this);
    for (const e of this._store.all()) {
      e.unselect();
    }
    this.toolSelected = this.tools[to];
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
