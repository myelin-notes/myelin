import {StateMachine} from "../../lib/utils/state-machine";
import {DrawableElement} from "./elements/drawable-element";
import {UndoCommand, UndoRedoStack} from "../../lib/utils/undo-redo";
import {PenTool} from "./tools/pen-tool";
import {ITool} from "./tools/tool";
import {EraserTool} from "./tools/eraser-tool";
import {ISerializable} from "../../lib/utils/binary-helper";
import {BinaryReader, BinaryWriter} from "../../lib/utils/binary-helper";
import {DrawableElementRegistry} from "./elements/drawable-element-registry";
import ElementType = DrawableElementRegistry.ElementType;
import {HighlighterTool} from "./tools/highlighter-tool";
import {SelectTool} from "./tools/select-tool";

export type Vector2 = { x: number, y: number };

class AddElementCommand implements UndoCommand {
    constructor(private list: DrawableElement[], private element: DrawableElement) {}
    execute() { this.list.push(this.element); }
    undo() {
        const idx = this.list.indexOf(this.element);
        if (idx >= 0) this.list.splice(idx, 1);
    }
}

class RemoveElementCommand implements UndoCommand {
    private position = -1;
    constructor(private list: DrawableElement[], private element: DrawableElement) {}
    execute() {
        const idx = this.list.indexOf(this.element);
        if (idx >= 0) {
            this.position = idx;
            this.list.splice(idx, 1);
        }
    }
    undo() {
        if (this.position >= 0) {
            this.list.splice(Math.min(this.position, this.list.length), 0, this.element);
        }
    }
}

export class DrawableCanvas implements ISerializable {

    public readonly ctx: CanvasRenderingContext2D;
    private readonly canvas: HTMLCanvasElement;
    private readonly state: StateMachine<InteractState>;
    public readonly tools: ITool[];
    private dotPattern: CanvasPattern | null = null;

    private offset: Vector2 = {x: 0, y: 0};
    private _zoom: number = 1;
    private spaceDown: boolean = false;
    private mousePosition: Vector2 = { x: 0, y: 0 };
    private bgColor: string;

    private _elements: DrawableElement[] = [];
    private _undoRedo = new UndoRedoStack();
    private _nextIndex = 0;
    private toolSelected: ITool;

    private onZoomChange?: (zoom: number) => void;

    public constructor(canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
            console.error("Failed to get canvas context");
        }

        this.canvas = canvas;
        this.ctx = ctx!;
        this.state = new StateMachine(InteractState.Idle);
        this.tools = DrawableCanvas.makeTools();
        this.toolSelected = this.tools[0];

        this.bgColor = getComputedStyle(canvas).getPropertyValue('--bg-page').trim() || '#f7f9fb';
        this.initEventListeners(canvas);
        this.initStates();
        this.resizeCanvas(window.innerWidth, window.innerHeight);
        this.buildDotPattern();
    }

    public setOnZoomChange(callback: (zoom: number) => void) {
        this.onZoomChange = callback;
    }

    public redraw(deltaTime: number) {
        this.ctx.fillStyle = this.bgColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw dot grid
        if (this.dotPattern) {
            this.ctx.save();
            this.ctx.scale(this._zoom, this._zoom);
            this.ctx.translate(this.offset.x, this.offset.y);
            this.ctx.fillStyle = this.dotPattern;
            this.ctx.fillRect(
                -this.offset.x - this.canvas.width / this._zoom,
                -this.offset.y - this.canvas.height / this._zoom,
                this.canvas.width * 3 / this._zoom,
                this.canvas.height * 3 / this._zoom,
            );
            this.ctx.restore();
        }

        this.ctx.save();
        this.ctx.scale(this._zoom, this._zoom);
        this.ctx.translate(this.offset.x, this.offset.y);
        this._elements.forEach(element => {
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
        this.state.addEnd(InteractState.UsingTool, event => {
            this.toolSelected.finish(this, event);
            this._undoRedo.endGroup();
        });

        this.state.addStart(InteractState.UsingTool, event => {
            this._undoRedo.beginGroup();
            this.toolSelected.start(this, event);
        });

        this.state.addUpdate(InteractState.UsingTool, (event: PointerEvent) => {
            this.toolSelected.update(this, event, this.getPoint(event));
        });

        this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
            const newPos = {
                x: event.movementX / this._zoom,
                y: event.movementY / this._zoom,
            };

            this.offset = {
                x: this.offset.x + newPos.x,
                y: this.offset.y + newPos.y,
            }
        });
    }

    private initEventListeners(canvas: HTMLCanvasElement) {
        canvas.addEventListener("wheel", evt => {
            const prevZoom = this._zoom;
            const newZoom = prevZoom + evt.deltaY * -0.005;
            this._zoom = Math.min(3, Math.max(0.2, newZoom));

            const canvasCenter = {
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
            };

            const worldCenterBeforeZoom = {
                x: (canvasCenter.x / prevZoom) - this.offset.x,
                y: (canvasCenter.y / prevZoom) - this.offset.y,
            };

            const worldCenterAfterZoom = {
                x: (canvasCenter.x / this._zoom) - this.offset.x,
                y: (canvasCenter.y / this._zoom) - this.offset.y,
            };

            this.offset.x += worldCenterAfterZoom.x - worldCenterBeforeZoom.x;
            this.offset.y += worldCenterAfterZoom.y - worldCenterBeforeZoom.y;

            this.onZoomChange?.(this._zoom);
        }, { passive: true });

        canvas.addEventListener("pointermove", evt => {
            this.mousePosition = this.getPoint(evt);
            this.state.update(evt);
        });

        canvas.addEventListener("pointerdown", evt => {
            switch (evt.pointerType) {
                case "touch":
                    this.state.change(InteractState.Moving, evt);
                    this.state.update(evt);
                    break;
                // @ts-ignore
                case "mouse":
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

        window.addEventListener("pointerup", evt => {
            this.state.change(InteractState.Idle, evt);
        });

        window.addEventListener("keyup", evt => {
            if (evt.key === " ") {
                this.spaceDown = false;
            }
        });

        window.addEventListener("keydown", evt => {
            if (evt.key === " ") {
                this.spaceDown = true;
            }

            if (evt.key === "z" && evt.ctrlKey) {
                this.undo();
            }

            if (evt.key === "Z" && evt.ctrlKey) {
                this.redo();
            }
        });

        window.addEventListener("resize", () => this.resizeCanvas(window.innerWidth, window.innerHeight));
    }

    public addElement<T extends DrawableElement>(factory: (i: number) => T): T {
        const element = factory(this._nextIndex++);
        this._undoRedo.push(new AddElementCommand(this._elements, element));
        return element;
    }

    public removeElement(element: DrawableElement) {
        this._undoRedo.push(new RemoveElementCommand(this._elements, element));
    }

    public switchTool(to: number) {
        this.toolSelected.interrupt(this);
        this.toolSelected = this.tools[to];
    }

    public updateBounding() {
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = Number.MIN_VALUE;
        let maxY = Number.MIN_VALUE;

		this._elements.forEach(element => {
            const rect = element.boundingBox;
            if (rect.left < minX) minX = rect.left;
            if (rect.right > maxX) maxX = rect.right;
            if (rect.top < minY) minY = rect.top;
            if (rect.bottom > maxY) maxY = rect.bottom;
		});
    }

    private buildDotPattern() {
        const spacing = 24;
        const dotRadius = 0.75;
        const patternCanvas = document.createElement("canvas");
        patternCanvas.width = spacing;
        patternCanvas.height = spacing;
        const pctx = patternCanvas.getContext("2d")!;
        pctx.fillStyle = "rgba(195, 199, 202, 0.35)";
        pctx.beginPath();
        pctx.arc(spacing / 2, spacing / 2, dotRadius, 0, Math.PI * 2);
        pctx.fill();
        this.dotPattern = this.ctx.createPattern(patternCanvas, "repeat");
    }

    private resizeCanvas(width: number, height: number) {
        this.canvas.width = width;
        this.canvas.height = height;
    }

    private undo() {
        this._undoRedo.undo();
        this.updateBounding();
    }

    private redo() {
        this._undoRedo.redo();
        this.updateBounding();
    }

    public collapse() {
        this._undoRedo.collapse();
    }

    public getPoint(evt: PointerEvent): Vector2 {
        const x = evt.pageX / this._zoom - this.offset.x;
        const y = evt.pageY / this._zoom - this.offset.y;
        return { x: x, y: y };
    }

    public load(reader: BinaryReader): void {
        this._zoom = reader.readF32();
        this.offset = { x: reader.readF32(), y: reader.readF32() };

        const count = reader.readU32();
        this._elements = [];
        for (let i = 0; i < count; i++) {
            this._elements.push(this.loadElement(reader));
        }
        this._nextIndex = this._elements.length > 0
            ? Math.max(...this._elements.map(e => e.index)) + 1
            : 0;

        this.onZoomChange?.(this._zoom);
    }

    public save(writer: BinaryWriter): void {
        writer.writeF32(this._zoom);
        writer.writeF32(this.offset.x);
        writer.writeF32(this.offset.y);

        writer.writeU32(this._elements.length);
        for (const ele of this._elements) {
            this.saveElement(ele, writer);
        }
    }

    private loadElement(reader: BinaryReader): DrawableElement {
        const type = reader.readU8() as ElementType;
        const index = reader.readU8();

        const constructor = DrawableElementRegistry.MAP[type];
        const ele = constructor(index);
        ele.load(reader);

        return ele;
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
        ];
    }
}

enum InteractState {
    UsingTool = 0,
    Moving,
    Idle,
}
