import type * as Y from 'yjs';
import { catalogs, type MessageGetter } from '@/lib/i18n/messages';
import { Logger } from '@/lib/logger';
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
import { EraserTool } from './tools/eraser-tool';
import { HighlighterTool } from './tools/highlighter-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { TextTool } from './tools/text-tool';
import type { ITool } from './tools/tool';
import type { ResolveNoteLinkId } from './page-frame/pm/markdown/note-links';
import { LOCAL_ORIGIN, type YDocManager } from './ydoc-manager';

export type Vector2 = { x: number; y: number };

export interface PlacementGhost {
  /** Bounds of the ghost rectangle, relative to the pointer's world position. */
  getBounds(): { x: number; y: number; width: number; height: number };
  /** Called when the user clicks to finalize placement. */
  onPlace(worldPos: Vector2): void;
}

const logger = new Logger('DrawableCanvas');

function isBackgroundElement(type: ElementType): boolean {
  return type === ElementType.PAGE_FRAME || type === ElementType.PDF;
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

  private _elements: DrawableElement[] = [];
  private _ydoc: YDocManager;
  private _domOverlayHost: HTMLElement | null = null;
  /** Maps Y.Map instances to their DrawableElement wrappers. */
  private _yMapToElement = new Map<Y.Map<unknown>, DrawableElement>();
  private _toolCursor: string = 'default';
  private toolSelected: ITool;
  private readonly resolveNoteLinkId?: ResolveNoteLinkId;

  private onElementEdit?: (element: DrawableElement | null) => void;

  // Event handlers (stored for cleanup in destroy())
  private _handlePointerDown!: (evt: PointerEvent) => void;
  private _handlePointerMove!: (evt: PointerEvent) => void;
  private _handlePointerUp!: (evt: PointerEvent) => void;
  private _handleResize!: () => void;

  // Element editing state (e.g., page frame inline editing)
  private _editingElement: DrawableElement | null = null;
  private _cleanupEditListeners: (() => void) | null = null;

  // One-shot placement state — orthogonal to tools. When set, the next
  // primary-button click finalizes placement and the state clears.
  private _placement: PlacementGhost | null = null;
  private _placementCleanup: (() => void) | null = null;
  private onPlacementEnd?: () => void;

  public constructor(
    canvas: HTMLCanvasElement,
    ydoc: YDocManager,
    tools?: ITool[],
    resolveNoteLinkId?: ResolveNoteLinkId,
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
    this.resolveNoteLinkId = resolveNoteLinkId;

    this.initEventListeners(canvas);
    this.initStates();
    this.resizeCanvas(window.innerWidth, window.innerHeight);
    this.buildBgPattern(UserPrefs.get('canvasBackground'));
    this.unsubBgPref = UserPrefs.subscribe('canvasBackground', (bg) => {
      this.buildBgPattern(bg);
    });

    // Hydrate existing elements from Y.Doc (for loaded documents)
    this.hydrateFromYDoc();

    // Observe Y.Array for future add/remove (handles undo/redo + remote changes)
    this._ydoc.elements.observe((event) => {
      this.handleYArrayChange(event);
    });
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
        this._elements.push(element);
        this._yMapToElement.set(yMap, element);
      }
    }
    // Sort: backgrounds (page frames, PDFs) first so other elements render on top.
    this._elements.sort((a, b) => {
      const aBg = isBackgroundElement(a.type) ? 0 : 1;
      const bBg = isBackgroundElement(b.type) ? 0 : 1;
      return aBg - bBg;
    });
    // Sync nextIndex
    if (this._elements.length > 0) {
      const maxIndex = Math.max(...this._elements.map((e) => e.index));
      if (maxIndex >= this._ydoc.nextIndex) {
        this._ydoc.nextIndex = maxIndex + 1;
      }
    }
  }

  /**
   * Create a DrawableElement from a Y.Map, bind it, and return it.
   */
  private createElementFromYMap(yMap: Y.Map<unknown>): DrawableElement | null {
    const type = yMap.get('type');
    const index = yMap.get('index');
    if (typeof type !== 'number' || typeof index !== 'number') {
      return null;
    }

    const factory = (
      ELEMENT_FACTORIES as Partial<Record<number, ElementFactory>>
    )[type];
    if (!factory) {
      return null;
    }

    const element = factory(index);
    if (element instanceof PageFrameElement) {
      element.setNoteLinkResolver(this.resolveNoteLinkId);
    }
    element.bindToYMap(yMap);
    this.bindElementSharedYState(element);
    return element;
  }

  private bindElementSharedYState(element: DrawableElement): void {
    element.bindSharedYState(this._ydoc);
  }

  /**
   * Handle Y.Array changes — keeps _elements in sync with the Y.Doc.
   * Fires on undo/redo and future remote changes.
   */
  private handleYArrayChange(event: Y.YArrayEvent<Y.Map<unknown>>): void {
    // Skip locally-originated changes — we already updated _elements inline
    if (event.transaction.origin === LOCAL_ORIGIN) {
      return;
    }

    let index = 0;
    for (const delta of event.changes.delta) {
      if ('retain' in delta) {
        index += delta.retain!;
      }
      if ('delete' in delta) {
        // Find and remove the elements that were deleted
        const count = delta.delete!;
        for (let i = 0; i < count; i++) {
          // Find which element was at this Y.Array position
          // We need to find elements that are no longer in the Y.Array
        }
      }
      if ('insert' in delta) {
        const inserted = delta.insert as Y.Map<unknown>[];
        for (const yMap of inserted) {
          if (!this._yMapToElement.has(yMap)) {
            const element = this.createElementFromYMap(yMap);
            if (element) {
              this._elements.splice(index, 0, element);
              this._yMapToElement.set(yMap, element);
            }
          }
          index++;
        }
      }
    }

    // Handle deletions: remove elements whose Y.Maps are no longer in the array
    const currentYMaps = new Set<Y.Map<unknown>>();
    for (let i = 0; i < this._ydoc.elements.length; i++) {
      currentYMaps.add(this._ydoc.elements.get(i));
    }
    this._elements = this._elements.filter((el) => {
      if (el.yMap && !currentYMaps.has(el.yMap)) {
        this._yMapToElement.delete(el.yMap);
        el.disposeDOM();
        return false;
      }
      return true;
    });

    this.updateBounding();
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
  }

  public getElementsByType(type: ElementType): DrawableElement[] {
    return this._elements.filter((e) => e.type === type);
  }

  public get editingElement(): DrawableElement | null {
    return this._editingElement;
  }

  public enterElementEdit(element: DrawableElement, event?: Event): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }

    // Stop the initiating event from bubbling to the document-level
    // click-outside listener we're about to register.
    event?.stopPropagation();

    this._editingElement = element;
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

    // Camera switches to "vertical-only pan + handle two-finger touch" mode.
    this.viewport.editMode = true;
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
    this.viewport.editMode = false;
    this.canvas.style.pointerEvents = '';
    this.canvas.style.zIndex = '10';
    this.onElementEdit?.(null);
  }

  public destroy(): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
    if (this._placement) {
      this.endPlacement();
    }
    this.unsubBgPref?.();
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

    for (const element of this._elements) {
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
      for (const element of this._elements) {
        element.drawSelectionOverlay(this.overlayCtx, element === editing);
      }
      this.overlayCtx.restore();
    }

    const host = this._domOverlayHost;
    if (host) {
      for (const element of this._elements) {
        element.syncDOM(this.viewport, host);
      }
    }
  }

  public get elements(): DrawableElement[] {
    return this._elements;
  }

  public getSelectedElements(): DrawableElement[] {
    return this._elements.filter((element) => element.isSelected);
  }

  public clearSelection(): void {
    for (const element of this._elements) {
      element.unselect();
    }
  }

  public selectElementsByIndex(indices: number[]): void {
    const selected = new Set(indices);
    this.clearSelection();
    for (const element of this._elements) {
      if (selected.has(element.index)) {
        element.select();
      }
    }
  }

  public selectAllElements(): void {
    if (this._editingElement || this._placement) {
      return;
    }
    for (const element of this._elements) {
      element.select();
    }
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
        options?.position ?? (background ? 0 : this._elements.length),
        this._elements.length,
      ),
    );

    this._ydoc.insertExistingElementMap(position, yMap);

    const element = this.createElementFromYMap(yMap);
    if (!element) {
      this._ydoc.removeElementMap(yMap);
      return null;
    }

    this._elements.splice(position, 0, element);
    this._yMapToElement.set(yMap, element);
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
   * Add a new element to the canvas. The factory receives the element index.
   * The element is created locally, bound to a new Y.Map, and added to the Y.Array.
   */
  public addElement<T extends DrawableElement>(factory: (i: number) => T): T {
    const index = this._ydoc.nextIndex;
    const element = factory(index);
    if (element instanceof PageFrameElement) {
      element.setNoteLinkResolver(this.resolveNoteLinkId);
    }

    // Build the Y.Map properties from the element's current state
    const props: Record<string, unknown> = {
      offsetX: element.offset.x,
      offsetY: element.offset.y,
      scaleX: element.scale.x,
      scaleY: element.scale.y,
      ...element.getYMapProps(),
    };

    // Create Y.Map and add to array (backgrounds go first so other elements
    // render on top of them).
    let yMap: Y.Map<unknown>;
    if (isBackgroundElement(element.type)) {
      yMap = this._ydoc.insertElementMap(0, element.type, index, props);
      this._elements.unshift(element);
    } else {
      yMap = this._ydoc.createElementMap(element.type, index, props);
      this._elements.push(element);
    }

    // Bind element to its Y.Map
    element.bindToYMap(yMap);
    this._yMapToElement.set(yMap, element);
    this.bindElementSharedYState(element);

    // Increment nextIndex
    this._ydoc.transact(() => {
      this._ydoc.nextIndex = index + 1;
    });

    return element;
  }

  public removeElement(element: DrawableElement) {
    const yMap = element.yMap;
    if (yMap) {
      this._ydoc.removeElementMap(yMap);
      this._yMapToElement.delete(yMap);
    }
    const idx = this._elements.indexOf(element);
    if (idx >= 0) {
      this._elements.splice(idx, 1);
    }
    element.disposeDOM();
  }

  public deleteSelected() {
    if (this._editingElement) {
      return;
    }
    const selected = this._elements.filter((e) => e.isSelected);
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
    for (const e of selected) {
      e.disposeDOM();
    }
    this._elements = this._elements.filter((e) => !selected.includes(e));
    this.updateBounding();
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
    for (const e of this._elements) {
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

    this._elements.forEach((element) => {
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
    });
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
