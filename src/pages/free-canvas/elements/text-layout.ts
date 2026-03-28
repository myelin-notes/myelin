const LINE_HEIGHT = 1.5;

export { LINE_HEIGHT };

export interface LayoutLine {
    blockIndex: number;
    startOffset: number;
    text: string;
    x: number;
    y: number;
    height: number;
    font: string;
}

export interface WrappedLine {
    text: string;
    startOffset: number;
}

export function wrapTextForLayout(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): WrappedLine[] {
    if (!text) return [{ text: "", startOffset: 0 }];

    const words = text.split(" ");
    const lines: WrappedLine[] = [];
    let currentLine = "";
    let lineStart = 0;

    for (const word of words) {
        const testLine = currentLine ? currentLine + " " + word : word;

        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push({ text: currentLine, startOffset: lineStart });
            lineStart += currentLine.length + 1;
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }

    if (currentLine || lines.length === 0) {
        lines.push({ text: currentLine, startOffset: lineStart });
    }

    return lines;
}
