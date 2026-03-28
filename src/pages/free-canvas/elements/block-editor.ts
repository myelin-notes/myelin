import type { LayoutLine } from "./text-layout";
import { BlockTypeRegistry } from "./block-types";

export interface EditableBlock {
    type: string;
    text: string;
}

export interface CursorPos {
    block: number;
    offset: number;
}

export class BlockEditor {
    private _blocks: EditableBlock[] = [];
    private _cursor: CursorPos = { block: 0, offset: 0 };
    private _desiredX: number = -1;
    private _layoutLines: LayoutLine[] = [];

    get blocks(): EditableBlock[] { return this._blocks; }
    get cursor(): CursorPos { return this._cursor; }
    get desiredX(): number { return this._desiredX; }
    set desiredX(v: number) { this._desiredX = v; }

    setBlocks(blocks: EditableBlock[]): void {
        this._blocks = blocks.map(b => ({ ...b }));
    }

    snapshotBlocks(): EditableBlock[] {
        return this._blocks.map(b => ({ ...b }));
    }

    setLayoutLines(lines: LayoutLine[]): void {
        this._layoutLines = lines;
    }

    resetCursorToEnd(): void {
        if (this._blocks.length === 0) {
            this._blocks.push({ type: "p", text: "" });
        }
        const last = this._blocks[this._blocks.length - 1];
        this._cursor = { block: this._blocks.length - 1, offset: last.text.length };
        this._desiredX = -1;
    }

    trimTrailingEmpty(): void {
        while (this._blocks.length > 1 && this._blocks[this._blocks.length - 1].text === "") {
            this._blocks.pop();
        }
    }

    insertText(text: string): void {
        if (this._blocks.length === 0) {
            this._blocks.push({ type: "p", text: "" });
            this._cursor = { block: 0, offset: 0 };
        }
        const block = this._blocks[this._cursor.block];
        block.text = block.text.slice(0, this._cursor.offset) + text + block.text.slice(this._cursor.offset);
        this._cursor.offset += text.length;
        this._desiredX = -1;

        if (text.endsWith(" ")) {
            this.checkMarkdownShortcut();
        }
    }

    handleKey(key: string, meta: boolean, _shift: boolean): "handled" | "exit" | "passthrough" {
        if (key === "Escape") return "exit";

        switch (key) {
            case "Backspace":
                this.handleBackspace();
                this._desiredX = -1;
                return "handled";
            case "Delete":
                this.handleDelete();
                this._desiredX = -1;
                return "handled";
            case "Enter":
                this.handleEnter();
                this._desiredX = -1;
                return "handled";
            case "ArrowLeft":
                this.moveCursorLeft();
                this._desiredX = -1;
                return "handled";
            case "ArrowRight":
                this.moveCursorRight();
                this._desiredX = -1;
                return "handled";
            case "ArrowUp":
                this.moveCursorUp();
                return "handled";
            case "ArrowDown":
                this.moveCursorDown();
                return "handled";
            case "Home":
                if (meta) {
                    this._cursor = { block: 0, offset: 0 };
                } else {
                    this._cursor.offset = 0;
                }
                this._desiredX = -1;
                return "handled";
            case "End":
                if (meta) {
                    const last = this._blocks.length - 1;
                    this._cursor = { block: last, offset: this._blocks[last].text.length };
                } else {
                    this._cursor.offset = this._blocks[this._cursor.block].text.length;
                }
                this._desiredX = -1;
                return "handled";
            case "a":
                if (meta) {
                    const last = this._blocks.length - 1;
                    this._cursor = { block: last, offset: this._blocks[last].text.length };
                    return "handled";
                }
                return "passthrough";
            default:
                return "passthrough";
        }
    }

    hitTestCursor(localX: number, localY: number, ctx: CanvasRenderingContext2D): boolean {
        if (this._layoutLines.length === 0) return false;

        this._desiredX = -1;

        for (const line of this._layoutLines) {
            if (localY >= line.y && localY < line.y + line.height) {
                this.positionCursorInLine(line, localX, ctx);
                return true;
            }
        }

        if (localY < this._layoutLines[0].y) {
            this._cursor = { block: 0, offset: 0 };
            return true;
        }

        const lastLine = this._layoutLines[this._layoutLines.length - 1];
        if (localY >= lastLine.y + lastLine.height) {
            this._cursor = {
                block: lastLine.blockIndex,
                offset: lastLine.startOffset + lastLine.text.length,
            };
            return true;
        }

        return false;
    }

    // ── Private helpers ──────────────────────────────────────────

    private handleBackspace(): void {
        const { block, offset } = this._cursor;
        if (offset > 0) {
            const b = this._blocks[block];
            b.text = b.text.slice(0, offset - 1) + b.text.slice(offset);
            this._cursor.offset--;
        } else if (block > 0) {
            const prev = this._blocks[block - 1];
            const newOffset = prev.text.length;
            prev.text += this._blocks[block].text;
            this._blocks.splice(block, 1);
            this._cursor = { block: block - 1, offset: newOffset };
        }
    }

    private handleDelete(): void {
        const { block, offset } = this._cursor;
        const b = this._blocks[block];
        if (offset < b.text.length) {
            b.text = b.text.slice(0, offset) + b.text.slice(offset + 1);
        } else if (block < this._blocks.length - 1) {
            b.text += this._blocks[block + 1].text;
            this._blocks.splice(block + 1, 1);
        }
    }

    private handleEnter(): void {
        const { block, offset } = this._cursor;
        const current = this._blocks[block];
        const remainder = current.text.slice(offset);
        current.text = current.text.slice(0, offset);

        const def = BlockTypeRegistry.get(current.type);
        const newType = def.continuesOnEnter ? current.type : "p";
        this._blocks.splice(block + 1, 0, { type: newType, text: remainder });
        this._cursor = { block: block + 1, offset: 0 };
    }

    private moveCursorLeft(): void {
        if (this._cursor.offset > 0) {
            this._cursor.offset--;
        } else if (this._cursor.block > 0) {
            this._cursor.block--;
            this._cursor.offset = this._blocks[this._cursor.block].text.length;
        }
    }

    private moveCursorRight(): void {
        const block = this._blocks[this._cursor.block];
        if (this._cursor.offset < block.text.length) {
            this._cursor.offset++;
        } else if (this._cursor.block < this._blocks.length - 1) {
            this._cursor.block++;
            this._cursor.offset = 0;
        }
    }

    private moveCursorUp(): void {
        const lineIdx = this.findCursorLineIndex();
        if (lineIdx <= 0) {
            this._cursor = { block: 0, offset: 0 };
            return;
        }
        this.positionCursorInLineByX(this._layoutLines[lineIdx - 1], this.getTargetX());
    }

    private moveCursorDown(): void {
        const lineIdx = this.findCursorLineIndex();
        if (lineIdx < 0 || lineIdx >= this._layoutLines.length - 1) {
            const last = this._blocks.length - 1;
            this._cursor = { block: last, offset: this._blocks[last].text.length };
            return;
        }
        this.positionCursorInLineByX(this._layoutLines[lineIdx + 1], this.getTargetX());
    }

    private getTargetX(): number {
        if (this._desiredX >= 0) return this._desiredX;
        const lineIdx = this.findCursorLineIndex();
        return lineIdx >= 0 ? this._layoutLines[lineIdx].x : 0;
    }

    private checkMarkdownShortcut(): void {
        const block = this._blocks[this._cursor.block];
        for (const def of BlockTypeRegistry.all()) {
            const trigger = def.markdownTrigger;
            if (trigger && trigger.test(block.text)) {
                block.type = def.name;
                block.text = "";
                this._cursor.offset = 0;
                break;
            }
        }
    }

    private findCursorLineIndex(): number {
        for (let i = 0; i < this._layoutLines.length; i++) {
            const line = this._layoutLines[i];
            if (line.blockIndex !== this._cursor.block) continue;
            const lineEnd = line.startOffset + line.text.length;
            if (this._cursor.offset >= line.startOffset && this._cursor.offset <= lineEnd) {
                return i;
            }
        }
        return this._layoutLines.length - 1;
    }

    private positionCursorInLine(line: LayoutLine, localX: number, ctx: CanvasRenderingContext2D): void {
        ctx.font = line.font;
        let bestOffset = 0;
        let bestDist = Math.abs(localX - line.x);

        for (let i = 1; i <= line.text.length; i++) {
            const w = ctx.measureText(line.text.slice(0, i)).width;
            const dist = Math.abs(localX - (line.x + w));
            if (dist < bestDist) {
                bestDist = dist;
                bestOffset = i;
            }
        }

        this._cursor = { block: line.blockIndex, offset: line.startOffset + bestOffset };
    }

    private positionCursorInLineByX(line: LayoutLine, targetX: number): void {
        const sizeMatch = line.font.match(/(\d+)px/);
        const fontSize = sizeMatch ? parseInt(sizeMatch[1]) : 16;
        const avgCharWidth = line.text.length > 0
            ? (line.text.length * fontSize * 0.5) / line.text.length
            : 8;
        const relX = targetX - line.x;
        const charIdx = Math.max(0, Math.min(line.text.length, Math.round(relX / avgCharWidth)));
        this._cursor = { block: line.blockIndex, offset: line.startOffset + charIdx };
    }
}
