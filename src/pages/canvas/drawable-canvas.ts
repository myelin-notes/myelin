import * as Y from 'yjs';
import { catalogs, type MessageGetter } from '@/lib/i18n/messages';
import { Logger } from '@/lib/logger';
import {
  describeElementType,
  summarizeDrawableElements,
} from '@/lib/note-state-summary';
import { UserPrefs } from '@/lib/user-prefs';
import { StateMachine } from '../../lib/utils/state-machine';
import { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import {
  ELEMENT_FACTORIES,
  type ElementFactory,
} from './elements/element-factories';
import { ElementType } from './elements/element-type';
import { PageFrameElement } from './elements/page-frame-element';
import { PdfElement } from './elements/pdf-element';
import type { ResolveNoteLink } from './page-frame/pm/markdown/note-links';
import { EraserTool } from './tools/eraser-tool';
import { HighlighterTool } from './tools/highlighter-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { TextTool } from './tools/text-tool';
import type { ITool } from './tools/tool';
import { LOCAL_ORIGIN, type YDocManager } from './ydoc-manager';

export type Vector2 = { x: number; y: number };

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
  private bgCtx: CanvasRenderingContext2D | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private readonly state: StateMachine<InteractState>;
  public readonly tools: ITool[];
  private bgPattern: CanvasPattern | null = null;
  private unsubBgPref: (() => void) | null = null;

  private spaceDown: boolean = false;
  private screenPosition: Vector2 = { x: 0, y: 0 };

  /** Element lookup keyed by stable uuid. */
  private _elements = new Map<string, DrawableElement>();
  /** Ordered list of element uuids in z-order (background first, foreground last). */
  private _elementOrder: string[] = [];
  /** Cached array snapshot for the public `elements` getter; null when stale. */
  private _orderedSnapshot: DrawableElement[] | null = null;
  private _ydoc: YDocManager;
  private _domOverlayHost: HTMLElement | null = null;
  /** Maps Y.Map instances to their DrawableElement wrappers. */
  private _yMapToElement = new Map<Y.Map<unknown>, DrawableElement>();
  private _toolCursor: string = 'default';
  private toolSelected: ITool;
  private readonly resolveNoteLink?: ResolveNoteLink;
  private onPageFrameRenamed?: (
    uuid: string,
    newName: string,
    oldName: string,
  ) => void;

  private onElementEdit?: (element: DrawableElement | null) => void;

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
  private _cleanupEditListeners: (() => void) | null = null;

  // One-shot placement state — orthogonal to tools. When set, the next
  // primary-button click finalizes placement and the state clears.
  private _placement: PlacementGhost | null = null;
  private _placementCleanup: (() => void) | null = null;
  private onPlacementEnd?: () => void;

  /**
   * Listeners notified when selection, element set, element order, edit mode,
   * or placement state changes — anything that affects view layers like the
   * selection reorder toolbar. Viewport pan/zoom uses a separate channel on
   * CanvasViewport.
   */
  private _changeListeners = new Set<() => void>();

  public constructor(
    canvas: HTMLCanvasElement,
    ydoc: YDocManager,
    tools?: ITool[],
    resolveNoteLink?: ResolveNoteLink,
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      logger.error('Failed to get canvas context');
    }

    this.canvas = canvas;
    this.canvas.style.zIndex = '10';
    this.ctx = ctx!;
    this.viewport = new CanvasViewport(canvas);
    this.state = new StateMachine(InteractState.Idle);
    this.tools = tools ?? DrawableCanvas.makeTools(() => catalogs.en);
    this.toolSelected = this.tools[0];
    this._ydoc = ydoc;
    this.resolveNoteLink = resolveNoteLink;

    this.initEventListeners(canvas);
    this.initStates();
    this.resizeCanvas(window.innerWidth, window.innerHeight);
    this.buildBgPattern(UserPrefs.get('canvasBackground'));
    this.unsubBgPref = UserPrefs.subscribe('canvasBackground', (bg) => {
      this.buildBgPattern(bg);
    });

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

  /**
   * Populate _elements from the current Y.Array state.
   * Called once on construction for loaded documents.
   */
  private hydrateFromYDoc(): void {
    for (let i = 0; i < this._ydoc.elements.length; i++) {
      const yMap = this._ydoc.elements.get(i);
      const element = this.createElementFromYMap(yMap);
      if (element) {
        this._elements.set(element.uuid, element);
        this._yMapToElement.set(yMap, element);
      }
    }
    this.rebuildElementOrderFromYDoc();
  }

  private invalidateOrderSnapshot(): void {
    this._orderedSnapshot = null;
    this.notifyChange();
  }

  public onChange(listener: () => void): () => void {
    this._changeListeners.add(listener);
    return () => {
      this._changeListeners.delete(listener);
    };
  }

  private notifyChange(): void {
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
      const element = this._yMapToElement.get(yMap);
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

    this._elementOrder = ordered.map(({ element }) => element.uuid);
    this.invalidateOrderSnapshot();
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
      if (element.isSelected) {
        this.notifyChange();
      }
    };
    if (element instanceof PageFrameElement) {
      element.setNoteLinkResolver(this.resolveNoteLink);
      element.setOnDisplayNameRenamed((uuid, newName, oldName) => {
        this.onPageFrameRenamed?.(uuid, newName, oldName);
      });
    }
    if (element instanceof PdfElement) {
      element.setExportElementsProvider(() => this.elements);
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

    let changedElementFields = false;
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
        changedElementFields =
          this.syncElementFromYMapEvent(yMap, event.keysChanged) ||
          changedElementFields;
        continue;
      }

      if (
        event instanceof Y.YArrayEvent &&
        event.target !== this._ydoc.elements
      ) {
        changedElementFields =
          this.syncElementFromNestedEvent(event) || changedElementFields;
      }
    }

    if (changedElementFields) {
      this.updateBounding();
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
    const element = this._yMapToElement.get(yMap);
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
    const element = this._yMapToElement.get(yMap);
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
          if (!this._yMapToElement.has(yMap)) {
            const element = this.createElementFromYMap(yMap);
            if (element) {
              this._elements.set(element.uuid, element);
              this._elementOrder.splice(position, 0, element.uuid);
              this._yMapToElement.set(yMap, element);
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
    for (const element of this._elements.values()) {
      if (element.yMap && !currentYMaps.has(element.yMap)) {
        this._yMapToElement.delete(element.yMap);
        element.disposeDOM();
        removedUuids.add(element.uuid);
      }
    }
    if (removedUuids.size > 0) {
      for (const uuid of removedUuids) {
        this._elements.delete(uuid);
      }
      this._elementOrder = this._elementOrder.filter(
        (uuid) => !removedUuids.has(uuid),
      );
    }

    this.rebuildElementOrderFromYDoc();
    this.updateBounding();
    logger.debug('Applied external canvas element change', {
      origin: String(event.transaction.origin ?? 'unknown'),
      ...summarizeDrawableElements(this.elements),
    });
  }

  public setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d', { alpha: true });
    this.resizeBgCanvas(window.innerWidth, window.innerHeight);
  }

  /**
   * Always-on-top canvas used to render selection outline + handles, so they
   * remain visible above DOM-backed editing chrome (where the main canvas is
   * lowered to z=2 to avoid strokes bleeding onto edited text).
   */
  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d', { alpha: true });
    this.resizeOverlayCanvas(window.innerWidth, window.innerHeight);
  }

  public setDomOverlayHost(host: HTMLElement): void {
    this._domOverlayHost = host;
  }

  public setOnElementEdit(callback: (element: DrawableElement | null) => void) {
    this.onElementEdit = callback;
  }

  public setOnPlacementEnd(callback: (() => void) | undefined) {
    this.onPlacementEnd = callback;
  }

  public get isPlacing(): boolean {
    return this._placement !== null;
  }

  public startPlacement(ghost: PlacementGhost): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
    if (this._placement) {
      this.endPlacement();
    }
    this._placement = ghost;
    this._toolCursor = 'copy';
    this.updateCursor();
    this.notifyChange();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.endPlacement();
      }
    };
    document.addEventListener('keydown', handleKey);
    this._placementCleanup = () => {
      document.removeEventListener('keydown', handleKey);
    };
  }

  public cancelPlacement(): void {
    if (this._placement) {
      this.endPlacement();
    }
  }

  private endPlacement(): void {
    this._placement = null;
    this._placementCleanup?.();
    this._placementCleanup = null;
    this._toolCursor = 'default';
    this.updateCursor();
    this.onPlacementEnd?.();
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

  public syncViewportEditModePan(): void {
    const element = this._editingElement;
    this.viewport.setEditMode(element !== null, {
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

    // Camera switches to edit-mode pan + two-finger touch handling.
    this.syncViewportEditModePan();
    const pe = event instanceof PointerEvent ? event : undefined;
    const editDomRoot = element.enterEditMode(this, pe?.clientX, pe?.clientY);
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

    // Click outside editing DOM exits edit mode (no DOM root → any click exits)
    const handlePointerDown = (e: PointerEvent) => {
      if (!editDomRoot?.contains(e.target as Node)) {
        this.exitElementEdit();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);

    this._cleanupEditListeners = () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
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

  public destroy(): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
    if (this._placement) {
      this.endPlacement();
    }
    this.unsubBgPref?.();
    this.unsubBgPref = null;
    this._ydoc.elements.unobserveDeep(this._handleYElementsChange);
    for (const element of this._elements.values()) {
      element.disposeDOM();
    }
    this._elements.clear();
    this._elementOrder = [];
    this.invalidateOrderSnapshot();
    this._yMapToElement.clear();
    this.viewport.destroy();
    this.canvas.removeEventListener('pointermove', this._handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this._handlePointerDown);
    window.removeEventListener('pointerup', this._handlePointerUp);
    window.removeEventListener('resize', this._handleResize);
  }

  public redraw(deltaTime: number) {
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    const zoom = this.viewport.zoom;
    const offset = this.viewport.offset;

    // Background canvas: dot grid + chrome (when not editing)
    if (this.bgCtx && this.bgCanvas) {
      const bgW = this.bgCanvas.width / dpr;
      const bgH = this.bgCanvas.height / dpr;
      this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bgCtx.clearRect(0, 0, bgW, bgH);

      if (this.bgPattern) {
        this.bgCtx.save();
        this.bgCtx.scale(zoom, zoom);
        this.bgCtx.translate(offset.x, offset.y);
        this.bgCtx.fillStyle = this.bgPattern;
        this.bgCtx.fillRect(
          -offset.x - bgW / zoom,
          -offset.y - bgH / zoom,
          (bgW * 3) / zoom,
          (bgH * 3) / zoom,
        );
        this.bgCtx.restore();
      }
    }

    // Foreground canvas: element content + tool cursor
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, logicalW, logicalH);

    this.ctx.save();
    this.ctx.scale(zoom, zoom);
    this.ctx.translate(offset.x, offset.y);

    for (const element of this.elements) {
      element.draw(this.ctx, deltaTime);
    }
    // Cursor: compute fresh from screen position so it's correct even if
    // the user wheel-zoomed without moving the mouse since.
    const mouseWorld = this.viewport.screenToWorld(this.screenPosition);
    if (this._placement) {
      this.drawPlacementGhost(this.ctx, mouseWorld);
    } else {
      this.toolSelected.drawCursor(this.ctx, mouseWorld);
    }
    this.ctx.restore();

    // Overlay canvas: selection outline + handles. Always above DOM chrome
    // so selection stays visible while a page frame is being edited (the
    // foreground canvas is lowered below chrome in that mode).
    if (this.overlayCtx && this.overlayCanvas) {
      const overlayW = this.overlayCanvas.width / dpr;
      const overlayH = this.overlayCanvas.height / dpr;
      this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.overlayCtx.clearRect(0, 0, overlayW, overlayH);
      this.overlayCtx.save();
      this.overlayCtx.scale(zoom, zoom);
      this.overlayCtx.translate(offset.x, offset.y);
      const editing = this._editingElement;
      for (const element of this.elements) {
        element.drawSelectionOverlay(this.overlayCtx, element === editing);
      }
      this.overlayCtx.restore();
    }

    const host = this._domOverlayHost;
    if (host) {
      for (const element of this.elements) {
        element.syncDOM(this.viewport, host);
      }
    }
  }

  public get elements(): DrawableElement[] {
    if (!this._orderedSnapshot) {
      const snapshot: DrawableElement[] = [];
      for (const uuid of this._elementOrder) {
        const element = this._elements.get(uuid);
        if (element) {
          snapshot.push(element);
        }
      }
      this._orderedSnapshot = snapshot;
    }
    return this._orderedSnapshot;
  }

  public getElementByUuid(uuid: string): DrawableElement | null {
    return this._elements.get(uuid) ?? null;
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

    this._elementOrder = moveElementOrderForSelection(
      this.getElementOrderItems(),
      selectedUuids,
      direction,
    );
    this.invalidateOrderSnapshot();
    this.persistCurrentElementOrder();
    return true;
  }

  private persistCurrentElementOrder(): void {
    this._ydoc.undoManager.stopCapturing();
    this._ydoc.transact(() => {
      for (let i = 0; i < this._elementOrder.length; i++) {
        const yMap = this._elements.get(this._elementOrder[i])?.yMap;
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
    for (const element of this._elements.values()) {
      element.unselect();
    }
  }

  public selectElementsByUuid(uuids: readonly string[]): void {
    this.clearSelection();
    for (const uuid of uuids) {
      this._elements.get(uuid)?.select();
    }
  }

  public selectAllElements(): void {
    if (this._editingElement || this._placement) {
      return;
    }
    for (const element of this._elements.values()) {
      element.select();
    }
  }

  private getZOrderForInsertion(position: number, background: boolean): number {
    const layer = background ? 0 : 1;
    let before: DrawableElement | null = null;
    let after: DrawableElement | null = null;

    for (let i = position - 1; i >= 0; i--) {
      const element = this._elements.get(this._elementOrder[i]);
      if (element && getElementLayer(element.type) === layer) {
        before = element;
        break;
      }
    }
    for (let i = position; i < this._elementOrder.length; i++) {
      const element = this._elements.get(this._elementOrder[i]);
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
    const position = Math.max(
      0,
      Math.min(
        options?.position ?? (background ? 0 : this._elementOrder.length),
        this._elementOrder.length,
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

    this._elements.set(element.uuid, element);
    this._elementOrder.splice(position, 0, element.uuid);
    this._yMapToElement.set(yMap, element);
    this.invalidateOrderSnapshot();
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
      this.screenPosition = { x: evt.pageX, y: evt.pageY };
      this.state.update(evt);
      const mouseWorld = this.viewport.screenToWorld(this.screenPosition);
      this.toolSelected.hover?.(this, mouseWorld);
      this.updateCursor();
    };
    canvas.addEventListener('pointermove', this._handlePointerMove);

    this._handlePointerDown = (evt) => {
      // One-shot placement intercepts primary-button clicks regardless of tool.
      if (this._placement) {
        if (evt.button === 0) {
          const worldPos = this.viewport.getPoint(evt);
          this._placement.onPlace(worldPos);
        }
        this.endPlacement();
        return;
      }

      switch (evt.pointerType) {
        case 'touch':
          this.state.change(InteractState.Moving, evt);
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
      this.state.change(InteractState.Idle, evt);
    };
    window.addEventListener('pointerup', this._handlePointerUp);

    this._handleResize = () => {
      this.resizeCanvas(window.innerWidth, window.innerHeight);
      this.resizeBgCanvas(window.innerWidth, window.innerHeight);
      this.resizeOverlayCanvas(window.innerWidth, window.innerHeight);
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
    const position = background ? 0 : this._elementOrder.length;
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
      this._elementOrder.unshift(uuid);
    } else {
      yMap = this._ydoc.createElementMap(element.type, uuid, props);
      this._elementOrder.push(uuid);
    }
    this._elements.set(uuid, element);

    // Bind element to its Y.Map
    element.bindToYMap(yMap);
    this._yMapToElement.set(yMap, element);
    this.bindElementSharedYState(element);
    this.invalidateOrderSnapshot();

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
      this._yMapToElement.delete(yMap);
    }
    if (this._elements.delete(element.uuid)) {
      this._elementOrder = this._elementOrder.filter(
        (uuid) => uuid !== element.uuid,
      );
      this.invalidateOrderSnapshot();
    }
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
    for (const element of this._elements.values()) {
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
          this._yMapToElement.delete(yMap);
        }
      }
    });
    const removedUuids = new Set<string>();
    for (const e of selected) {
      e.disposeDOM();
      this._elements.delete(e.uuid);
      removedUuids.add(e.uuid);
    }
    this._elementOrder = this._elementOrder.filter(
      (uuid) => !removedUuids.has(uuid),
    );
    this.invalidateOrderSnapshot();
    this.updateBounding();
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
    for (const e of this._elements.values()) {
      e.unselect();
    }
    this.toolSelected = this.tools[to];
    this._toolCursor = 'default';
    this.updateCursor();
  }

  public updateBounding() {
    let minX = Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxX = Number.MIN_VALUE;
    let maxY = Number.MIN_VALUE;

    for (const element of this._elements.values()) {
      const rect = element.boundingBox;
      if (rect.left < minX) {
        minX = rect.left;
      }
      if (rect.right > maxX) {
        maxX = rect.right;
      }
      if (rect.top < minY) {
        minY = rect.top;
      }
      if (rect.bottom > maxY) {
        maxY = rect.bottom;
      }
    }
  }

  private drawPlacementGhost(ctx: CanvasRenderingContext2D, worldPos: Vector2) {
    if (!this._placement) {
      return;
    }
    const b = this._placement.getBounds();
    const x = worldPos.x + b.x;
    const y = worldPos.y + b.y;

    ctx.fillStyle = 'rgba(208, 225, 251, 0.18)';
    ctx.beginPath();
    ctx.roundRect(x, y, b.width, b.height, 6);
    ctx.fill();

    ctx.strokeStyle = '#2f3e46';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(x, y, b.width, b.height, 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private buildBgPattern(style: 'grid' | 'dots' | 'blank') {
    if (style === 'blank') {
      this.bgPattern = null;
      return;
    }

    const spacing = 24;
    const tile = new OffscreenCanvas(spacing, spacing);
    const pctx = tile.getContext('2d')!;
    const color = 'rgba(164, 168, 172, 0.35)';

    if (style === 'dots') {
      pctx.fillStyle = color;
      pctx.beginPath();
      pctx.arc(spacing / 2, spacing / 2, 0.75, 0, Math.PI * 2);
      pctx.fill();
    } else {
      // grid
      pctx.strokeStyle = color;
      pctx.lineWidth = 0.5;
      pctx.beginPath();
      pctx.moveTo(spacing, 0);
      pctx.lineTo(spacing, spacing);
      pctx.moveTo(0, spacing);
      pctx.lineTo(spacing, spacing);
      pctx.stroke();
    }

    this.bgPattern = this.ctx.createPattern(tile, 'repeat');
  }

  private resizeCanvas(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private resizeBgCanvas(width: number, height: number) {
    if (!this.bgCanvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.bgCanvas.width = width * dpr;
    this.bgCanvas.height = height * dpr;
    this.bgCanvas.style.width = `${width}px`;
    this.bgCanvas.style.height = `${height}px`;
  }

  private resizeOverlayCanvas(width: number, height: number) {
    if (!this.overlayCanvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width = width * dpr;
    this.overlayCanvas.height = height * dpr;
    this.overlayCanvas.style.width = `${width}px`;
    this.overlayCanvas.style.height = `${height}px`;
  }

  public setSpaceDown(value: boolean) {
    this.spaceDown = value;
    this.updateCursor();
  }

  public undo() {
    this._ydoc.undoManager.undo();
    this.updateBounding();
  }

  public redo() {
    this._ydoc.undoManager.redo();
    this.updateBounding();
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
