import {Stroke} from "./Stroke.ts";
import {StateMachine} from "../utils/StateMachine.ts";
import {Ref, ref} from "vue";
import {DrawableElement} from "./DrawableElement.ts";

export type Vector2 = { x: number, y: number };

export class DrawableCanvas {

    // @ts-ignore
    private readonly ctx: CanvasRenderingContext2D;
    // @ts-ignore
    private readonly canvas: HTMLCanvasElement;
    // @ts-ignore
    private readonly state: StateMachine<InteractState>;

    private spaceDown: boolean = false;
    private elements: DrawableElement[] = [];
    private offset: Vector2 = {x: 0, y: 0};
    private zoom: Ref<number> = ref(1);
    private physicalSize: DOMRect = new DOMRect();
    private currentStroke: Stroke | null = null;

    public constructor(canvas: HTMLCanvasElement | null) {
        if (!canvas) {
            console.error("Failed to get canvas ref");
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            console.error("Failed to get canvas context");
            return;
        }

        this.canvas = canvas;
        this.ctx = ctx;
        this.state = new StateMachine(InteractState.Idle);

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
        this.elements.forEach(element => {
            element.draw(this.ctx, deltaTime);
        });
        // this.ctx.strokeStyle = "red";
        // this.ctx.strokeRect(this.physicalSize.left, this.physicalSize.top, this.physicalSize.width, this.physicalSize.height);
        this.ctx.restore();
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

    private initStates() {
        this.state.addEnd(InteractState.Drawing, () => {
            this.currentStroke?.updateBounds();
            this.currentStroke = null
            this.updateBounding();
        });

        this.state.addStart(InteractState.Drawing, () => {
            const stroke = new Stroke([], false);
            this.addElement(stroke);
            this.currentStroke = stroke;
        });

        this.state.addUpdate(InteractState.Drawing, (event: PointerEvent) => {
            const x = event.pageX / this.zoom.value - this.offset.x;
            const y = event.pageY / this.zoom.value - this.offset.y;
            this.currentStroke?.addPoint(x, y, event.pressure);
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
            this.zoom.value += evt.deltaY * -0.0005;
            this.zoom.value = Math.min(3, Math.max(0.2, this.zoom.value));
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
                    
                    if (evt.button === 0 && this.within(this.physicalSize, { x: x, y: y })) {
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
                    this.state.change(InteractState.Drawing);
                    this.state.update(evt);
                    break;
            }
        });
        
        window.addEventListener("pointerup", evt => {
            switch (evt.pointerType) {
                case "mouse":
                    this.state.change(InteractState.Selecting);
                    break;
                case "touch":
                default:
                    this.state.change(InteractState.Idle);
                    break;
            }
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
        });

        window.addEventListener("resize", () => this.resizeCanvas(window.innerWidth, window.innerHeight));
    }

    private addElement(element: DrawableElement) {
        this.elements = [...this.elements, element];
    }

    private updateBounding() {
        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = Number.MIN_VALUE;
        let maxY = Number.MIN_VALUE;

        for (const element of this.elements) {
            const rect = element.boundingBox();

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

            console.log(rect);
        }

        this.physicalSize = new DOMRect(minX, minY, maxX - minX, maxY - minY);
    }

    private resizeCanvas(width: number, height: number) {
        this.canvas.width = width;
        this.canvas.height = height;
    }
    
    private within(rect: DOMRect, point: Vector2) {
        return point.x >= rect.x &&
            point.x < rect.x + rect.width &&
            point.y > rect.y &&
            point.y < rect.y + rect.height;
    }
}

enum InteractState {
    Drawing = 0,
    Moving,
    Selecting,
    Idle,
}