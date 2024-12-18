import {Vector2} from "./DrawableCanvas.ts";

export abstract class DrawableElement {
    
    private scale: Vector2 = { x: 1, y: 1 };
    private elapsed = 0;
    
    public draw(ctx: CanvasRenderingContext2D, deltaTime: number): void {
        this.elapsed += deltaTime;
        
        if (this.boundingBox().width > 20) {
            this.changeDimensionRelative(Math.sin(Math.PI * this.elapsed * 0.5), 0);
        }
        
        ctx.save();
        ctx.scale(this.scale.x, this.scale.y);
        this.draw2D(ctx, deltaTime);
        ctx.restore();
    }

    public select() {
    }
    
    public unselect() {
    }

    public changeDimensionRelative(x: number, y: number) {
        const propX = x / this.boundingBox().width;
        const propY = y / this.boundingBox().height;
        
        this.scale.x = this.scale.x + propX;
        this.scale.y = this.scale.y + propY;
        
        this.updateBounds();
    }

    public updateBounds() {
        this.updateBoundingBox(this.scale);
    }
    
    public abstract boundingBox(): DOMRect;
    protected abstract updateBoundingBox(scale: Vector2): void;
    protected abstract draw2D(ctx: CanvasRenderingContext2D, deltaTime: number): void;
}
