import type {
  BinaryReader,
  BinaryWriter,
  ISerializable,
} from '../../lib/utils/binary-helper';
import { StateMachine } from '../../lib/utils/state-machine';
import type { UndoCommand } from '../../lib/utils/undo-redo';
import { UndoRedoStack } from '../../lib/utils/undo-redo';
import { CanvasViewport } from './canvas-viewport';
import { AddElementCommand, RemoveElementCommand } from './commands';
import type { DrawableElement } from './elements/drawable-element';
import { DrawableElementRegistry } from './elements/drawable-element-registry';
import { ElementType } from './elements/element-type';
import { ImageElement } from './elements/image-element';
import type { PageFrameElement } from './elements/page-frame-element';
import { EmbedTool } from './tools/embed-tool';
import { EraserTool } from './tools/eraser-tool';
import { HighlighterTool } from './tools/highlighter-tool';
import { PenTool } from './tools/pen-tool';
import { SelectTool } from './tools/select-tool';
import { TextTool } from './tools/text-tool';
import type { ITool } from './tools/tool';

export type Vector2 = { x: number; y: number };

export class DrawableCanvas implements ISerializable {
  public readonly ctx: CanvasRenderingContext2D;
  public readonly viewport: CanvasViewport;
  private readonly canvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private readonly state: StateMachine<InteractState>;
  public readonly tools: ITool[];
  private dotPattern: CanvasPattern | null = null;

  private spaceDown: boolean = false;
  private screenPosition: Vector2 = { x: 0, y: 0 };

  private _elements: DrawableElement[] = [];
  private _undoRedo = new UndoRedoStack();
  private _nextIndex = 0;
  private toolSelected: ITool;
  private _toolCursor: string = 'default';

  private onRequestFilePick?: (screenPos: Vector2) => void;
  private onElementEdit?: (element: DrawableElement | null) => void;

  // Event handlers (stored for cleanup in destroy())
  private _handlePointerDown!: (evt: PointerEvent) => void;
  private _handlePointerMove!: (evt: PointerEvent) => void;
  private _handlePointerUp!: (evt: PointerEvent) => void;
  private _handleResize!: () => void;

  // Element editing state (e.g., page frame inline editing)
  private _editingElement: DrawableElement | null = null;

  public constructor(canvas: HTMLCanvasElement, tools?: ITool[]) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      console.error('Failed to get canvas context');
    }

    this.canvas = canvas;
    this.canvas.style.zIndex = '5';
    this.ctx = ctx!;
    this.viewport = new CanvasViewport(canvas);
    this.state = new StateMachine(InteractState.Idle);
    this.tools = tools ?? DrawableCanvas.makeTools();
    this.toolSelected = this.tools[0];

    this.initEventListeners(canvas);
    this.initStates();
    this.resizeCanvas(window.innerWidth, window.innerHeight);
    this.buildDotPattern();
  }

  public setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d', { alpha: true });
    this.resizeBgCanvas(window.innerWidth, window.innerHeight);
  }

  public setOnRequestFilePick(callback: (screenPos: Vector2) => void) {
    this.onRequestFilePick = callback;
  }

  public setOnElementEdit(callback: (element: DrawableElement | null) => void) {
    this.onElementEdit = callback;
  }

  public getElementsByType(type: ElementType): DrawableElement[] {
    return this._elements.filter((e) => e.type === type);
  }

  public requestFilePick(screenPos: Vector2) {
    this.onRequestFilePick?.(screenPos);
  }

  public get editingElement(): DrawableElement | null {
    return this._editingElement;
  }

  public enterElementEdit(
    element: DrawableElement,
    screenX?: number,
    screenY?: number,
  ): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
    this._editingElement = element;
    // Drop foreground canvas between background (z:0) and DOM (z:2)
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '1';
    // Camera switches to "vertical-only pan + handle two-finger touch" mode.
    this.viewport.editMode = true;
    element.enterEditMode(this, screenX, screenY);
    this.onElementEdit?.(element);
  }

  public exitElementEdit(): void {
    if (!this._editingElement) {
      return;
    }
    const element = this._editingElement;
    const undoCmd = element.exitEditMode();
    if (undoCmd) {
      this.pushApplied(undoCmd);
    }
    this._editingElement = null;
    this.viewport.editMode = false;
    // Restore foreground canvas above DOM layer
    this.canvas.style.pointerEvents = '';
    this.canvas.style.zIndex = '5';
    this.onElementEdit?.(null);
  }

  public destroy(): void {
    if (this._editingElement) {
      this.exitElementEdit();
    }
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

    const editing = this._editingElement !== null;
    const zoom = this.viewport.zoom;
    const offset = this.viewport.offset;

    // Background canvas: dot grid + chrome (when not editing)
    if (this.bgCtx && this.bgCanvas) {
      const bgW = this.bgCanvas.width / dpr;
      const bgH = this.bgCanvas.height / dpr;
      this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bgCtx.clearRect(0, 0, bgW, bgH);

      if (this.dotPattern) {
        this.bgCtx.save();
        this.bgCtx.scale(zoom, zoom);
        this.bgCtx.translate(offset.x, offset.y);
        this.bgCtx.fillStyle = this.dotPattern;
        this.bgCtx.fillRect(
          -offset.x - bgW / zoom,
          -offset.y - bgH / zoom,
          (bgW * 3) / zoom,
          (bgH * 3) / zoom,
        );
        this.bgCtx.restore();
      }

      if (!editing) {
        this.bgCtx.save();
        this.bgCtx.scale(zoom, zoom);
        this.bgCtx.translate(offset.x, offset.y);
        for (const element of this._elements) {
          if (element.type === ElementType.PAGE_FRAME) {
            (element as PageFrameElement).drawChrome(this.bgCtx);
          }
        }
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
    // When editing, chrome draws after strokes (but below DOM text at z:2).
    // Page frames are sorted to front so we stop at the first non-frame.
    if (editing) {
      for (const element of this._elements) {
        if (element.type !== ElementType.PAGE_FRAME) {
          break;
        }
        (element as PageFrameElement).drawChrome(this.ctx);
      }
    }

    // Cursor: compute fresh from screen position so it's correct even if
    // the user wheel-zoomed without moving the mouse since.
    const mouseWorld = this.viewport.screenToWorld(this.screenPosition);
    this.toolSelected.drawCursor(this.ctx, mouseWorld);
    this.ctx.restore();
  }

  public get elements(): DrawableElement[] {
    return this._elements;
  }

  private initStates() {
    this.state.addEnd(InteractState.UsingTool, (event) => {
      this.toolSelected.finish(this, event);
      this._undoRedo.endGroup();
    });

    this.state.addStart(InteractState.UsingTool, (event) => {
      this._undoRedo.beginGroup();
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
      // During page frame editing, any click that reaches the canvas
      // (i.e. outside the raised DOM contentEditable) exits edit mode
      // and re-selects the frame so handles remain visible.
      if (this._editingElement) {
        const el = this._editingElement;
        this.exitElementEdit();
        el.select();
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
    };
    window.addEventListener('resize', this._handleResize);
  }

  public addElement<T extends DrawableElement>(factory: (i: number) => T): T {
    const element = factory(this._nextIndex++);
    this._undoRedo.push(new AddElementCommand(this._elements, element));
    return element;
  }

  public removeElement(element: DrawableElement) {
    this._undoRedo.push(new RemoveElementCommand(this._elements, element));
  }

  public deleteSelected() {
    const selected = this._elements.filter((e) => e.isSelected);
    if (selected.length === 0) {
      return;
    }
    this._undoRedo.beginGroup();
    for (const e of selected) {
      e.unselect();
      this._undoRedo.push(new RemoveElementCommand(this._elements, e));
    }
    this._undoRedo.endGroup();
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
    img.setPosition(
      world.x - img.naturalWidth / 2,
      world.y - img.naturalHeight / 2,
    );
    img.updateBounds();
    this.updateBounding();
  }

  public pushApplied(command: UndoCommand) {
    this._undoRedo.pushApplied(command);
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

  private buildDotPattern() {
    const spacing = 24;
    const dotRadius = 0.75;
    const tile = new OffscreenCanvas(spacing, spacing);
    const pctx = tile.getContext('2d')!;
    pctx.fillStyle = 'rgba(195, 199, 202, 0.35)';
    pctx.beginPath();
    pctx.arc(spacing / 2, spacing / 2, dotRadius, 0, Math.PI * 2);
    pctx.fill();
    this.dotPattern = this.ctx.createPattern(tile, 'repeat');
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
    this._undoRedo.undo();
    this.updateBounding();
  }

  public redo() {
    this._undoRedo.redo();
    this.updateBounding();
  }

  public collapse() {
    this._undoRedo.collapse();
  }

  public load(reader: BinaryReader): void {
    this.viewport.load(reader);

    const count = reader.readU32();
    this._elements = [];
    for (let i = 0; i < count; i++) {
      this._elements.push(this.loadElement(reader));
    }
    // Page frames draw first (below other elements)
    this._elements.sort((a, b) => {
      const aIsFrame = a.type === ElementType.PAGE_FRAME ? 0 : 1;
      const bIsFrame = b.type === ElementType.PAGE_FRAME ? 0 : 1;
      return aIsFrame - bIsFrame;
    });
    this._nextIndex =
      this._elements.length > 0
        ? Math.max(...this._elements.map((e) => e.index)) + 1
        : 0;
  }

  public save(writer: BinaryWriter): void {
    this.viewport.save(writer);

    writer.writeU32(this._elements.length);
    for (const ele of this._elements) {
      this.saveElement(ele, writer);
    }
  }

  private loadElement(reader: BinaryReader): DrawableElement {
    const type = reader.readU8() as ElementType;
    const index = reader.readU8();

    const factory = DrawableElementRegistry.MAP[type];
    const element = factory(index);
    element.load(reader);

    return element;
  }

  private saveElement(ele: DrawableElement, writer: BinaryWriter) {
    writer.writeU8(ele.type);
    writer.writeU8(ele.index);
    ele.save(writer);
  }

  public static makeTools(): ITool[] {
    return [
      new SelectTool(),
      new PenTool(),
      new HighlighterTool(),
      new EraserTool(),
      new TextTool(),
      new EmbedTool(),
    ];
  }
}

enum InteractState {
  UsingTool = 0,
  Moving,
  Idle,
}
