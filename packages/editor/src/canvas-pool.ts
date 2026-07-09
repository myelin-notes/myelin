/**
 * Reusable staging canvases. Released canvases are kept at size so a
 * same-sized render reuses the backing store instead of reallocating a
 * page-sized buffer; overflow beyond the capacity is shrunk to 1×1 so the
 * backing store is released immediately.
 */
export class CanvasPool {
  private readonly canvases: HTMLCanvasElement[] = [];

  constructor(private readonly capacity: number) {}

  acquire(): HTMLCanvasElement {
    return this.canvases.pop() ?? document.createElement('canvas');
  }

  release(canvas: HTMLCanvasElement): void {
    if (this.canvases.length < this.capacity) {
      this.canvases.push(canvas);
      return;
    }
    canvas.width = 1;
    canvas.height = 1;
  }

  drain(): void {
    for (const canvas of this.canvases) {
      canvas.width = 1;
      canvas.height = 1;
    }
    this.canvases.length = 0;
  }
}
