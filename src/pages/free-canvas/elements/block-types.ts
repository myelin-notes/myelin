import { LINE_HEIGHT } from "./text-layout";

export interface BlockStyle {
    font: string;
    size: number;
    color: string;
    indent: number;
}

export abstract class BlockTypeDef {
    abstract readonly id: number;
    abstract readonly name: string;
    abstract readonly style: BlockStyle;

    /** Regex that, when matched at the start of a block's text, converts the block to this type. */
    get markdownTrigger(): RegExp | null { return null; }

    /** If true, pressing Enter at the end of this block creates another of the same type. */
    get continuesOnEnter(): boolean { return false; }

    /** Draw block-level decoration (bullets, bars, etc.) before text lines. */
    drawDecoration(_ctx: CanvasRenderingContext2D, _x: number, _y: number): void {}
}

// ── Registry ─────────────────────────────────────────────────

const byName = new Map<string, BlockTypeDef>();
const byId = new Map<number, BlockTypeDef>();

function register(def: BlockTypeDef): void {
    byName.set(def.name, def);
    byId.set(def.id, def);
}

export namespace BlockTypeRegistry {
    export function get(name: string): BlockTypeDef {
        return byName.get(name) ?? byName.get("p")!;
    }

    export function getById(id: number): BlockTypeDef {
        return byId.get(id) ?? byName.get("p")!;
    }

    export function all(): IterableIterator<BlockTypeDef> {
        return byName.values();
    }
}

// ── Concrete block types ─────────────────────────────────────

class ParagraphBlock extends BlockTypeDef {
    readonly id = 0;
    readonly name = "p";
    readonly style: BlockStyle = { font: '400 16px "Inter", sans-serif', size: 16, color: "#191c1e", indent: 0 };
}

class Heading1Block extends BlockTypeDef {
    readonly id = 1;
    readonly name = "h1";
    readonly style: BlockStyle = { font: '700 32px "Newsreader", serif', size: 32, color: "#191c1e", indent: 0 };
    get markdownTrigger() { return /^# $/; }
}

class Heading2Block extends BlockTypeDef {
    readonly id = 2;
    readonly name = "h2";
    readonly style: BlockStyle = { font: '700 24px "Newsreader", serif', size: 24, color: "#191c1e", indent: 0 };
    get markdownTrigger() { return /^## $/; }
}

class Heading3Block extends BlockTypeDef {
    readonly id = 3;
    readonly name = "h3";
    readonly style: BlockStyle = { font: '600 20px "Newsreader", serif', size: 20, color: "#191c1e", indent: 0 };
    get markdownTrigger() { return /^### $/; }
}

class ListItemBlock extends BlockTypeDef {
    readonly id = 4;
    readonly name = "li";
    readonly style: BlockStyle = { font: '400 16px "Inter", sans-serif', size: 16, color: "#191c1e", indent: 24 };
    get markdownTrigger() { return /^- $/; }
    get continuesOnEnter() { return true; }

    drawDecoration(ctx: CanvasRenderingContext2D, x: number, y: number): void {
        ctx.fillStyle = this.style.color;
        ctx.beginPath();
        ctx.arc(x + this.style.indent - 12, y + this.style.size * 0.6, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

class BlockquoteBlock extends BlockTypeDef {
    readonly id = 5;
    readonly name = "blockquote";
    readonly style: BlockStyle = { font: '400 16px "Inter", sans-serif', size: 16, color: "#64748b", indent: 18 };
    get markdownTrigger() { return /^> $/; }

    drawDecoration(ctx: CanvasRenderingContext2D, x: number, y: number): void {
        ctx.fillStyle = "rgba(195, 199, 202, 0.5)";
        ctx.fillRect(x + 2, y, 3, this.style.size * LINE_HEIGHT);
    }
}

// ── Registration ─────────────────────────────────────────────

register(new ParagraphBlock());
register(new Heading1Block());
register(new Heading2Block());
register(new Heading3Block());
register(new ListItemBlock());
register(new BlockquoteBlock());
