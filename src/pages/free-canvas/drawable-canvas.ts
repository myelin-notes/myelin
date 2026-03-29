import type {
  BinaryReader,
  BinaryWriter,
  ISerializable,
} from '../../lib/utils/binary-helper';
import { StateMachine } from '../../lib/utils/state-machine';
import type { UndoCommand } from '../../lib/utils/undo-redo';
import { UndoRedoStack } from '../../lib/utils/undo-redo';
import {
  AddElementCommand,
  EditPageFrameCommand,
  RemoveElementCommand,
} from './commands';
import type { DrawableElement } from './elements/drawable-element';
import { DrawableElementRegistry } from './elements/drawable-element-registry';
import { ElementType } from './elements/element-type';
import { ImageElement } from './elements/image-element';
import type { PageFrameElement } from './elements/page-frame-element';
import type { EditableBlock } from './page-frame/block-editor';
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
  private readonly canvas: HTMLCanvasElement;
  private readonly state: StateMachine<InteractState>;
  public readonly tools: ITool[];
  private dotPattern: CanvasPattern | null = null;

  private _offset: Vector2 = { x: 0, y: 0 };
  private _zoom: number = 1;
  private spaceDown: boolean = false;
  private mousePosition: Vector2 = { x: 0, y: 0 };
  private screenPosition: Vector2 = { x: 0, y: 0 };

  private _elements: DrawableElement[] = [];
  private _undoRedo = new UndoRedoStack();
  private _nextIndex = 0;
  private toolSelected: ITool;
  private _toolCursor: string = 'default';

  private onZoomChange?: (zoom: number) => void;
  private onRequestTextEdit?: (
    screenPos: Vector2,
    screenFontSize: number,
    fontFamily: string,
    initialText: string,
    boxScreenWidth: number,
    boxScreenHeight: number,
    onCommit: (text: string) => void,
  ) => void;
  private onRequestFilePick?: (screenPos: Vector2) => void;
  private onPageFrameEdit?: (element: PageFrameElement | null) => void;

  // Page frame editing state
  private _editingElement: PageFrameElement | null = null;
  private _getEditingBlocks?: () => EditableBlock[];

  public constructor(canvas: HTMLCanvasElement, tools?: ITool[]) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      console.error('Failed to get canvas context');
    }

    this.canvas = canvas;
    this.ctx = ctx!;
    this.state = new StateMachine(InteractState.Idle);
    this.tools = tools ?? DrawableCanvas.makeTools();
    this.toolSelected = this.tools[0];

    this.initEventListeners(canvas);
    this.initStates();
    this.resizeCanvas(window.innerWidth, window.innerHeight);
    this.buildDotPattern();
  }

  public setOnZoomChange(callback: (zoom: number) => void) {
    this.onZoomChange = callback;
  }

  public setOnRequestTextEdit(
    callback: (
      screenPos: Vector2,
      screenFontSize: number,
      fontFamily: string,
      initialText: string,
      boxScreenWidth: number,
      boxScreenHeight: number,
      onCommit: (text: string) => void,
    ) => void,
  ) {
    this.onRequestTextEdit = callback;
  }

  public requestTextEdit(
    screenPos: Vector2,
    screenFontSize: number,
    fontFamily: string,
    initialText: string,
    boxScreenWidth: number,
    boxScreenHeight: number,
    onCommit: (text: string) => void,
  ) {
    this.onRequestTextEdit?.(
      screenPos,
      screenFontSize,
      fontFamily,
      initialText,
      boxScreenWidth,
      boxScreenHeight,
      onCommit,
    );
  }

  public setOnRequestFilePick(callback: (screenPos: Vector2) => void) {
    this.onRequestFilePick = callback;
  }

  public setOnPageFrameEdit(
    callback: (element: PageFrameElement | null) => void,
  ) {
    this.onPageFrameEdit = callback;
  }

  public setGetEditingBlocks(fn: () => EditableBlock[]) {
    this._getEditingBlocks = fn;
  }

  public get viewOffset(): Vector2 {
    return this._offset;
  }

  public get pageFrames(): PageFrameElement[] {
    return this._elements.filter(
      (e) => e.type === ElementType.PAGE_FRAME,
    ) as PageFrameElement[];
  }

  public requestFilePick(screenPos: Vector2) {
    this.onRequestFilePick?.(screenPos);
  }

  public get editingElement(): PageFrameElement | null {
    return this._editingElement;
  }

  private _oldBlocks: EditableBlock[] = [];

  public enterPageFrameEdit(element: PageFrameElement): void {
    if (this._editingElement) {
      this.exitPageFrameEdit();
    }
    this._editingElement = element;
    this._oldBlocks = element.editor.snapshotBlocks();
    element.enterEditMode();
    this.onPageFrameEdit?.(element);
  }

  public exitPageFrameEdit(newBlocks?: EditableBlock[]): void {
    if (!this._editingElement) {
      return;
    }

    const element = this._editingElement;

    // Get blocks from DOM if not provided directly
    let blocks = newBlocks;
    if (!blocks && this._getEditingBlocks) {
      blocks = this._getEditingBlocks();
    }

    if (blocks) {
      element.editor.setBlocks(blocks);
    }

    const finalBlocks = element.editor.snapshotBlocks();
    element.exitEditMode();

    const changed =
      JSON.stringify(finalBlocks) !== JSON.stringify(this._oldBlocks);
    if (changed) {
      this.pushApplied(
        new EditPageFrameCommand(element, this._oldBlocks, finalBlocks),
      );
    }

    this._editingElement = null;
    this.onPageFrameEdit?.(null);
  }

  public destroy(): void {
    if (this._editingElement) {
      this.exitPageFrameEdit();
    }
  }

  public redraw(deltaTime: number) {
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, logicalW, logicalH);

    // Draw dot grid (needs to follow zoom/pan)
    if (this.dotPattern) {
      this.ctx.save();
      this.ctx.scale(this._zoom, this._zoom);
      this.ctx.translate(this._offset.x, this._offset.y);
      this.ctx.fillStyle = this.dotPattern;
      this.ctx.fillRect(
        -this._offset.x - logicalW / this._zoom,
        -this._offset.y - logicalH / this._zoom,
        (logicalW * 3) / this._zoom,
        (logicalH * 3) / this._zoom,
      );
      this.ctx.restore();
    }

    this.ctx.save();
    this.ctx.scale(this._zoom, this._zoom);
    this.ctx.translate(this._offset.x, this._offset.y);
    this._elements.forEach((element) => {
      element.draw(this.ctx, deltaTime);
    });

    this.toolSelected.drawCursor(this.ctx, this.mousePosition);
    this.ctx.restore();
  }

  public get zoom(): number {
    return this._zoom;
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
      this.toolSelected.update(this, event, this.getPoint(event));
    });

    this.state.addStart(InteractState.Moving, () => {
      this.updateCursor();
    });

    this.state.addEnd(InteractState.Moving, () => {
      this.updateCursor();
    });

    this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
      const newPos = {
        x: event.movementX / this._zoom,
        y: event.movementY / this._zoom,
      };

      this._offset = {
        x: this._offset.x + newPos.x,
        y: this._offset.y + newPos.y,
      };
    });
  }

  private initEventListeners(canvas: HTMLCanvasElement) {
    canvas.addEventListener(
      'wheel',
      (evt) => {
        if (evt.ctrlKey) {
          // Pinch-to-zoom on trackpad (browser sets ctrlKey for pinch gestures)
          evt.preventDefault();
          if (this._editingElement) {
            return;
          }
          const prevZoom = this._zoom;
          const newZoom = prevZoom + evt.deltaY * -0.005;
          this._zoom = Math.min(3, Math.max(0.2, newZoom));

          const dpr = window.devicePixelRatio || 1;
          const canvasCenter = {
            x: this.canvas.width / dpr / 2,
            y: this.canvas.height / dpr / 2,
          };

          const worldCenterBeforeZoom = {
            x: canvasCenter.x / prevZoom - this._offset.x,
            y: canvasCenter.y / prevZoom - this._offset.y,
          };

          const worldCenterAfterZoom = {
            x: canvasCenter.x / this._zoom - this._offset.x,
            y: canvasCenter.y / this._zoom - this._offset.y,
          };

          this._offset.x += worldCenterAfterZoom.x - worldCenterBeforeZoom.x;
          this._offset.y += worldCenterAfterZoom.y - worldCenterBeforeZoom.y;

          this.onZoomChange?.(this._zoom);
        } else {
          // Two-finger scroll on trackpad / mouse wheel → pan
          this._offset.x -= evt.deltaX / this._zoom;
          this._offset.y -= evt.deltaY / this._zoom;
        }
        this.mousePosition = this.screenToWorld(this.screenPosition);
      },
      { passive: false },
    );

    canvas.addEventListener('pointermove', (evt) => {
      this.screenPosition = { x: evt.pageX, y: evt.pageY };
      this.mousePosition = this.screenToWorld(this.screenPosition);
      this.state.update(evt);
      this.toolSelected.hover?.(this, this.mousePosition);
      this.updateCursor();
    });

    canvas.addEventListener('pointerdown', (evt) => {
      // During page frame editing, any click that reaches the canvas
      // (i.e. outside the raised DOM contentEditable) exits edit mode
      if (this._editingElement) {
        this.exitPageFrameEdit();
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
    });

    window.addEventListener('pointerup', (evt) => {
      this.state.change(InteractState.Idle, evt);
    });

    window.addEventListener('resize', () =>
      this.resizeCanvas(window.innerWidth, window.innerHeight),
    );
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
    const world = this.screenToWorld({ x: cx, y: cy });
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
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = spacing;
    patternCanvas.height = spacing;
    const pctx = patternCanvas.getContext('2d')!;
    pctx.fillStyle = 'rgba(195, 199, 202, 0.35)';
    pctx.beginPath();
    pctx.arc(spacing / 2, spacing / 2, dotRadius, 0, Math.PI * 2);
    pctx.fill();
    this.dotPattern = this.ctx.createPattern(patternCanvas, 'repeat');
  }

  private resizeCanvas(width: number, height: number) {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  public worldToScreen(world: Vector2): Vector2 {
    return {
      x: (world.x + this._offset.x) * this._zoom,
      y: (world.y + this._offset.y) * this._zoom,
    };
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

  public screenToWorld(screen: Vector2): Vector2 {
    return {
      x: screen.x / this._zoom - this._offset.x,
      y: screen.y / this._zoom - this._offset.y,
    };
  }

  public getPoint(evt: PointerEvent): Vector2 {
    return this.screenToWorld({ x: evt.pageX, y: evt.pageY });
  }

  public load(reader: BinaryReader): void {
    this._zoom = reader.readF32();
    this._offset = { x: reader.readF32(), y: reader.readF32() };

    const count = reader.readU32();
    this._elements = [];
    for (let i = 0; i < count; i++) {
      this._elements.push(this.loadElement(reader));
    }
    this._nextIndex =
      this._elements.length > 0
        ? Math.max(...this._elements.map((e) => e.index)) + 1
        : 0;

    this.onZoomChange?.(this._zoom);
  }

  public save(writer: BinaryWriter): void {
    writer.writeF32(this._zoom);
    writer.writeF32(this._offset.x);
    writer.writeF32(this._offset.y);

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
