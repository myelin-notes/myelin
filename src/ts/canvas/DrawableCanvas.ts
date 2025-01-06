import {StateMachine} from "../utils/StateMachine.ts";
import {Ref, ref} from "vue";
import {DrawableElement} from "./DrawableElement.ts";
import {UndoableState} from "../utils/UndoRedo.ts";
import {ITool} from "./tools/Tools.ts";
import {PenTool} from "./tools/PenTool.ts";

export type Vector2 = { x: number, y: number };

export class DrawableCanvas {

    private readonly ctx: CanvasRenderingContext2D;
    private readonly canvas: HTMLCanvasElement;
    private readonly state: StateMachine<InteractState>;
    public readonly tools: ITool[];

    private offset: Vector2 = {x: 0, y: 0};
    private zoom: Ref<number> = ref(1);
    private physicalSize: DOMRect = new DOMRect();
    private spaceDown: boolean = false;
    
    private elements: UndoableState<DrawableElement> = new UndoableState();
    private toolSelected: ITool;

    public constructor(canvas: HTMLCanvasElement) {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.error("Failed to get canvas context");
        }

        this.canvas = canvas;
        this.ctx = ctx!;
        this.state = new StateMachine(InteractState.Idle);
        this.tools = DrawableCanvas.makeTools();
        
        this.toolSelected = this.tools[0];

        this.initEventListeners(canvas);
        this.initStates();
        this.resizeCanvas(window.innerWidth, window.innerHeight);
    }

    public redraw(deltaTime: number) {
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.save();
        this.ctx.scale(this.zoom.value, this.zoom.value);
        this.ctx.translate(this.offset.x, this.offset.y);
        this.elements.actives.forEach(element => {
            element.draw(this.ctx, deltaTime);
        });
        this.ctx.restore();
    }

    public addElement(element: DrawableElement) {
        this.elements.add(element);
    }
    
    public switchTool(to: number) {
        console.log("Switched tool to " + to);
        this.toolSelected.interrupt(this);
        this.toolSelected = this.tools[to];
    }

    public updateBounding() {
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = Number.MIN_VALUE;
        let maxY = Number.MIN_VALUE;

        for (const element of this.elements.actives) {
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

        this.physicalSize = new DOMRect(minX, minY, maxX - minX, maxY - minY);
    }

    public get getZoom() {
        return this.zoom;
    }

    public get getOffset() {
        return this.offset;
    }

    public get getPhysicalSize() {
        return this.physicalSize
    }
    
    public get getElements() {
        return this.elements.actives;
    }
    
    // public removeElement() {
    //     this.elements.
    // }

    public within(rect: DOMRect, point: Vector2) {
        return point.x >= rect.x &&
            point.x < rect.x + rect.width &&
            point.y > rect.y &&
            point.y < rect.y + rect.height;
    }
    
    private initStates() {
        this.state.addEnd(InteractState.UsingTool, event => {
            this.toolSelected.finish(this, event);
        });

        this.state.addStart(InteractState.UsingTool, event => {
            this.toolSelected.start(this, event);
        });

        this.state.addUpdate(InteractState.UsingTool, (event: PointerEvent) => {
            const x = event.pageX / this.zoom.value - this.offset.x;
            const y = event.pageY / this.zoom.value - this.offset.y;
            this.toolSelected.update(this, event, { x: x, y: y });
        });

        this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
            const newPos = {
                x: event.movementX / this.zoom.value,
                y: event.movementY / this.zoom.value,
            };

            this.offset = {
                x: this.offset.x + newPos.x,
                y: this.offset.y + newPos.y,
            }
        });
    }

    private initEventListeners(canvas: HTMLCanvasElement) {
        canvas.addEventListener("wheel", evt => {
            const prevZoom = this.zoom.value;
            const newZoom = prevZoom + evt.deltaY * -0.001;
            // this.zoom.value = Math.min(3, Math.max(0.2, newZoom));
            this.zoom.value = newZoom;

            // Calculate the canvas center relative to the current zoom and offset
            const canvasCenter = {
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
            };

            const worldCenterBeforeZoom = {
                x: (canvasCenter.x / prevZoom) - this.offset.x,
                y: (canvasCenter.y / prevZoom) - this.offset.y,
            };

            const worldCenterAfterZoom = {
                x: (canvasCenter.x / this.zoom.value) - this.offset.x,
                y: (canvasCenter.y / this.zoom.value) - this.offset.y,
            };

            // Adjust the offset to maintain the same visual center
            this.offset.x += worldCenterAfterZoom.x - worldCenterBeforeZoom.x;
            this.offset.y += worldCenterAfterZoom.y - worldCenterBeforeZoom.y;
        });

        canvas.addEventListener("pointermove", evt => {
            this.state.update(evt);
        });

        canvas.addEventListener("pointerdown", evt => {
            switch (evt.pointerType) {
                case "touch":
                    this.state.change(InteractState.Moving);
                    this.state.update(evt);
                    break;
                // @ts-ignore
                case "mouse":
                    const x = evt.pageX / this.zoom.value - this.offset.x;
                    const y = evt.pageY / this.zoom.value - this.offset.y;

                    if (evt.button === 0 && this.within(this.physicalSize, {x: x, y: y})) {
                        break;
                    }

                    // middle click
                    if (this.spaceDown || evt.button === 1) {
                        this.state.change(InteractState.Moving);
                        this.state.update(evt);
                        break;
                    }

                    if (evt.button === 2) {
                        break;
                    }
                // fallthrough
                default:
                    this.state.change(InteractState.UsingTool);
                    this.state.update(evt);
                    break;
            }
        });

        window.addEventListener("pointerup", _evt => {
            this.state.change(InteractState.Idle);
        });

        window.addEventListener("keyup", evt => {
            if (evt.key === " ") {
                this.spaceDown = false;
            }
        });

        window.addEventListener("keydown", evt => {
            if (evt.key === " ") {
                this.spaceDown = true;
                console.log(this.elements);
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

    private resizeCanvas(width: number, height: number) {
        this.canvas.width = width;
        this.canvas.height = height;
    }
    
    private undo() {
        this.elements.undo();
        this.updateBounding();
    }

    private redo() {
        this.elements.redo();
        this.updateBounding();
    }
    
    public static makeTools() {
        return [
            new PenTool(),
            new PenTool(),
            new PenTool(),
            new PenTool(),
            new PenTool(),
            new PenTool(),
            new PenTool(),
        ];
    }
}

enum InteractState {
    UsingTool = 0,
    Moving,
    Idle,
}