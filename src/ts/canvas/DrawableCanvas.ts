import {Stroke} from "./Stroke.ts";
import {StateMachine} from "./StateMachine.ts";

export class DrawableCanvas {

    // @ts-ignore
    private readonly ctx: CanvasRenderingContext2D;
    // @ts-ignore
    private readonly canvas: HTMLCanvasElement;
    // @ts-ignore
    private readonly state: StateMachine<InteractState>;

    private spaceDown: boolean = false;
    private elements: IDrawableElement[] = [];
    private offset: [number, number] = [0, 0];

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
                    break;
                // @ts-ignore
                case "mouse":
                    // fallthrough
                    if (this.spaceDown || evt.button === 2) {
                        this.state.change(InteractState.Moving);
                        break;
                    }
                default:
                    this.state.change(InteractState.Drawing);
                    break;
            }
        });

        canvas.addEventListener("pointerup", evt => {
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
            }
        });

        this.canvas = canvas;
        this.ctx = ctx;
        this.state = new StateMachine(InteractState.Idle);
        this.initStates();
    }

    public redraw() {
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.translate(this.offset[0], this.offset[1]);
        this.elements.forEach(element => {
            element.draw(this.ctx);
        })

        console.log(this.elements);
    }

    private addElement(element: IDrawableElement) {
        this.elements = [...this.elements, element];
    }

    private initStates() {
        this.state.addEnd(InteractState.Drawing, () => this.currentStroke = null);
        this.state.addStart(InteractState.Drawing, () => {
            const stroke = new Stroke([], false);
            this.addElement(stroke);
            this.currentStroke = stroke;
        });
        this.state.addUpdate(InteractState.Drawing, (event: PointerEvent) => {
            this.currentStroke?.addPoint(event.pageX, event.pageY, event.pressure);
        });

        this.state.addUpdate(InteractState.Moving, (event: PointerEvent) => {
            this.offset = [event.pageX, event.pageY];
        });
    }
}

export interface IDrawableElement {
    draw(ctx: CanvasRenderingContext2D): void;
}

enum InteractState {
    Drawing = 0,
    Moving,
    Selecting,
    Idle,
}