import {Stroke} from "./Stroke.ts";
import {StateMachine} from "../utils/StateMachine.ts";

export type Vector2 = { x: number, y: number };
export class DrawableCanvas {

    // @ts-ignore
    private readonly ctx: CanvasRenderingContext2D;
    // @ts-ignore
    private readonly canvas: HTMLCanvasElement;
    // @ts-ignore
    private readonly state: StateMachine<InteractState>;

    private spaceDown: boolean = false;
    private elements: IDrawableElement[] = [];
    private offset: Vector2 = { x: 0, y: 0 };
    private zoom: number = 1;
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
        
        canvas.addEventListener("wheel", evt => {
            this.zoom += evt.deltaY * -0.0005;
            // clamp between 0 and 4
            this.zoom = Math.min(2.5, Math.max(0.4, this.zoom));
            this.resizeCanvas(window.innerWidth / this.zoom, window.innerHeight / this.zoom);
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

        this.canvas = canvas;
        this.ctx = ctx;
        this.state = new StateMachine(InteractState.Idle);
        
        this.initStates();
        this.resizeCanvas(window.innerWidth, window.innerHeight);
    }

    public redraw() {
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.resetTransform();
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(this.offset.x, this.offset.y);
        this.elements.forEach(element => {
            element.draw(this.ctx);
        });
        
        this.ctx.strokeStyle = "red";
        this.ctx.strokeRect(this.physicalSize.left, this.physicalSize.top, this.physicalSize.width, this.physicalSize.height);

        console.log(this.canvas.width);
        console.log(this.canvas.height);
    }
    
    public resizeCanvas(width: number, height: number) {
        if (width < this.physicalSize.width) {
            width = this.physicalSize.width;
        }

        if (height < this.physicalSize.height) {
            height = this.physicalSize.height;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
    }
    
    public get getPhysicalSize() {
        return this.physicalSize;
    }

    private addElement(element: IDrawableElement) {
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
        console.log(this.physicalSize);
    }

    private initStates() {
        this.state.addEnd(InteractState.Drawing, () => {
            this.currentStroke?.buildBoundingBox();
            this.currentStroke = null
            this.updateBounding();
        });
        
        this.state.addStart(InteractState.Drawing, () => {
            const stroke = new Stroke([], false);
            this.addElement(stroke);
            this.currentStroke = stroke;
        });
        
        this.state.addUpdate(InteractState.Drawing, (event: PointerEvent) => {
            const x = (event.pageX - this.offset.x) / this.zoom;
            const y = (event.pageY - this.offset.y) / this.zoom;
            
            if (this.withinCanvas(x, y)) {
                this.currentStroke?.addPoint(x, y, event.pressure);
                return;
            }
            
            this.currentStroke?.buildBoundingBox();
            this.currentStroke = null;
        });

        this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
            const newPos = {
                x: event.movementX / this.zoom,
                y: event.movementY / this.zoom,
            };
            
            this.offset = {
                x: this.offset.x + newPos.x,
                y: this.offset.y + newPos.y,
            }
        });
    }
    
    private withinCanvas(x: number, y: number) {
        const rect = this.canvas.getBoundingClientRect();
        return (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
        );
    }
}

export interface IDrawableElement {
    draw(ctx: CanvasRenderingContext2D): void;
    boundingBox(): DOMRect;
}

enum InteractState {
    Drawing = 0,
    Moving,
    Selecting,
    Idle,
}