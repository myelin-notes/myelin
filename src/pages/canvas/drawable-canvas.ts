import type * as Y from 'yjs';
import { catalogs } from '@/lib/i18n/messages';
import { loadDocument } from '@/lib/pdf-renderer';
import { UserPrefs } from '@/lib/user-prefs';
import { StateMachine } from '../../lib/utils/state-machine';
import { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import { ElementType } from './elements/element-type';
import { ImageElement } from './elements/image-element';
import { PageFrameElement } from './elements/page-frame-element';
import { PdfElement } from './elements/pdf-element';
import { StrokeElement } from './elements/stroke-element';
import { TextElement } from './elements/text-element';
import { EmbedTool } from './tools/embed-tool';
import { EraserTool } from './tools/eraser-tool';
import { HighlighterTool } from './tools/highlighter-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { TextTool } from './tools/text-tool';
import type { CanvasStringsGetter, ITool } from './tools/tool';
import { LOCAL_ORIGIN, type YDocManager } from './ydoc-manager';

export type Vector2 = { x: number; y: number };

function isBackgroundElement(type: ElementType): boolean {
  return type === ElementType.PAGE_FRAME || type === ElementType.PDF;
}

export class DrawableCanvas {
  public readonly ctx: CanvasRenderingContext2D;
  public readonly viewport: CanvasViewport;
  private readonly canvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
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
  private toolSelected: ITool;
  private _toolCursor: string = 'default';

  private onElementEdit?: (element: DrawableElement | null) => void;

  // Event handlers (stored for cleanup in destroy())
  private _handlePointerDown!: (evt: PointerEvent) => void;
  private _handlePointerMove!: (evt: PointerEvent) => void;
  private _handlePointerUp!: (evt: PointerEvent) => void;
  private _handleResize!: () => void;

  // Element editing state (e.g., page frame inline editing)
  private _editingElement: DrawableElement | null = null;
  private _cleanupEditListeners: (() => void) | null = null;

  public constructor(
    canvas: HTMLCanvasElement,
    ydoc: YDocManager,
    tools?: ITool[],
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      console.error('Failed to get canvas context');
    }

    this.canvas = canvas;
    this.canvas.style.zIndex = '10';
    this.ctx = ctx!;
    this.viewport = new CanvasViewport(canvas);
    this.state = new StateMachine(InteractState.Idle);
    this.tools = tools ?? DrawableCanvas.makeTools(() => catalogs.en.canvas);
    this.toolSelected = this.tools[0];
    this._ydoc = ydoc;

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
    const type = yMap.get('type') as ElementType;
    const index = yMap.get('index') as number;

    let element: DrawableElement;
    switch (type) {
      case ElementType.STROKE:
        element = new StrokeElement(index, [], false, {
          color: 'black',
          size: 12,
        });
        break;
      case ElementType.TEXT:
        element = new TextElement(index);
        break;
      case ElementType.IMAGE:
        element = new ImageElement(index);
        break;
      case ElementType.PAGE_FRAME: {
        const pf = new PageFrameElement(index);
        const frag = this._ydoc.getXmlFragment(index);
        pf.bindYProseMirror(frag);
        element = pf;
        break;
      }
      case ElementType.PDF:
        element = new PdfElement(index);
        break;
      default:
        return null;
    }

    element.bindToYMap(yMap);
    return element;
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

  public setDomOverlayHost(host: HTMLElement): void {
    this._domOverlayHost = host;
  }

  public setOnElementEdit(callback: (element: DrawableElement | null) => void) {
    this.onElementEdit = callback;
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
    // Drop foreground canvas below DOM layer (z:5) so editing UI receives events
    this.canvas.style.pointerEvents = 'none';
    if (
      this.editingElement instanceof PageFrameElement ||
      this.editingElement instanceof PdfElement
    ) {
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
    // Restore foreground canvas above DOM layer (z:5)
    this.canvas.style.pointerEvents = '';
    this.canvas.style.zIndex = '10';
    this.onElementEdit?.(null);
  }

  public destroy(): void {
    if (this._editingElement) {
      this.exitElementEdit();
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

    // Foreground canvas
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
    this.toolSelected.drawCursor(this.ctx, mouseWorld);
    this.ctx.restore();

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

    // For PageFrames, also bind the XmlFragment
    if (element instanceof PageFrameElement) {
      const frag = this._ydoc.getXmlFragment(index);
      element.bindYProseMirror(frag);
    }

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

  public async addImageFromBlob(
    blob: Blob,
    screenX?: number,
    screenY?: number,
  ) {
    const data = await blob.arrayBuffer();
    const img = this.addElement((i) => new ImageElement(i));
    await img.setImageData(data);

    // Place at given screen position (or center of viewport)
    const dpr = window.devicePixelRatio || 1;
    const cx = screenX ?? this.canvas.width / dpr / 2;
    const cy = screenY ?? this.canvas.height / dpr / 2;
    const world = this.viewport.screenToWorld({ x: cx, y: cy });
    img.setOffset(
      world.x - img.naturalWidth / 2,
      world.y - img.naturalHeight / 2,
    );
    img.updateBounds();
    this.updateBounding();
  }

  public async addPdfFromBlob(blob: Blob, screenX?: number, screenY?: number) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const doc = await loadDocument(bytes);
    const pageSizes: { w: number; h: number }[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({ w: viewport.width, h: viewport.height });
    }

    const pdf = this.addElement((i) => new PdfElement(i));
    pdf.setInitialPdfData(bytes, pageSizes, doc);

    const dpr = window.devicePixelRatio || 1;
    const cx = screenX ?? this.canvas.width / dpr / 2;
    const cy = screenY ?? this.canvas.height / dpr / 2;
    const world = this.viewport.screenToWorld({ x: cx, y: cy });
    pdf.setOffset(world.x - pdf.totalWidth / 2, world.y - pdf.totalHeight / 2);
    pdf.updateBounds();
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

  public static makeTools(getStrings: CanvasStringsGetter): ITool[] {
    return [
      new SelectTool(getStrings),
      new PenTool(getStrings),
      new HighlighterTool(getStrings),
      new EraserTool(getStrings),
      new TextTool(getStrings),
      new EmbedTool(getStrings),
    ];
  }
}

enum InteractState {
  UsingTool = 0,
  Moving,
  Idle,
}
