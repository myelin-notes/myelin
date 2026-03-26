export interface GraphConfig {
    width: number;
    height: number;
    expressions?: string[];
    xMin?: number;
    xMax?: number;
    yMin?: number;
    yMax?: number;
}

export interface GraphInstance {
    setExpressions(exprs: string[]): void;
    setBounds(xMin: number, yMin: number, xMax: number, yMax: number): void;
    resize(width: number, height: number): void;
    render(): Promise<ImageBitmap>;
    destroy(): void;
}
