import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import type { CanvasPalette } from '../../canvas-theme';
import { schema } from '../pm/schema';
import { renderPageFrameThumbnail } from './render';

const PALETTE: CanvasPalette = {
  grid: '#000',
  selectionStroke: '#000',
  selectionFill: '#000',
  surface: '#fff',
  border: '#cbd2d9',
  accentDark: '#1c2738',
  waveformTrack: '#d0d5db',
  recording: '#e03e3e',
  textPrimary: '#1f2933',
  textMuted: '#7b8794',
  muted: '#f0f2f5',
};

interface FillTextCall {
  text: string;
  x: number;
  y: number;
}

/**
 * Minimal CanvasRenderingContext2D stub that records the calls the renderer
 * makes. measureText returns a width proportional to length so word-wrap is
 * deterministic without a real canvas backend.
 */
function createStubContext(): {
  ctx: CanvasRenderingContext2D;
  fillTexts: FillTextCall[];
} {
  const fillTexts: FillTextCall[] = [];
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textBaseline: 'alphabetic',
    fillText(text: string, x: number, y: number) {
      fillTexts.push({ text, x, y });
    },
    measureText(text: string) {
      return { width: text.length * 8 } as TextMetrics;
    },
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    rect() {},
    roundRect() {},
    clip() {},
    save() {},
    restore() {},
    translate() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fillTexts };
}

function paragraph(text: string): ProseMirrorNode {
  return schema.nodes.paragraph.create(
    null,
    text.length > 0 ? schema.text(text) : undefined,
  );
}

function heading(level: number, text: string): ProseMirrorNode {
  return schema.nodes.heading.create({ level }, schema.text(text));
}

function bulletItem(text: string): ProseMirrorNode {
  return schema.nodes.bulletListItem.create(null, schema.text(text));
}

function makeDoc(blocks: ProseMirrorNode[]): ProseMirrorNode {
  return schema.nodes.doc.create(null, blocks);
}

const OPTS = { width: 500, maxHeight: 800 };

describe('renderPageFrameThumbnail', () => {
  it('renders heading, paragraph, and list text in document order', () => {
    const doc = makeDoc([
      heading(1, 'Title'),
      paragraph('Hello world'),
      bulletItem('First item'),
    ]);
    const { ctx, fillTexts } = createStubContext();

    renderPageFrameThumbnail(doc, ctx, OPTS, PALETTE);

    const texts = fillTexts.map((c) => c.text);
    expect(texts).toContain('Title');
    expect(texts).toContain('Hello world');
    expect(texts).toContain('First item');
    expect(texts).toContain('•');

    // Blocks advance the y-cursor in document order.
    const titleY = fillTexts.find((c) => c.text === 'Title')!.y;
    const helloY = fillTexts.find((c) => c.text === 'Hello world')!.y;
    const itemY = fillTexts.find((c) => c.text === 'First item')!.y;
    expect(titleY).toBeLessThan(helloY);
    expect(helloY).toBeLessThan(itemY);
  });

  it('wraps long paragraphs onto multiple advancing lines', () => {
    // 30 words; each "word" is 4 chars => ~40px with the 1-space join. At
    // width 500 (~62 chars), several words fit per line and wrap repeatedly.
    const words = Array.from({ length: 30 }, (_, i) => `wo${i}`).join(' ');
    const doc = makeDoc([paragraph(words)]);
    const { ctx, fillTexts } = createStubContext();

    renderPageFrameThumbnail(doc, ctx, OPTS, PALETTE);

    expect(fillTexts.length).toBeGreaterThan(1);
    const ys = fillTexts.map((c) => c.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });

  it('does not throw on an empty doc', () => {
    const doc = makeDoc([paragraph('')]);
    const { ctx, fillTexts } = createStubContext();

    expect(() => renderPageFrameThumbnail(doc, ctx, OPTS, PALETTE)).not.toThrow();
    expect(fillTexts).toHaveLength(0);
  });

  it('stops drawing once the y-cursor passes maxHeight (bounded)', () => {
    const blocks = Array.from({ length: 2000 }, (_, i) =>
      paragraph(`line number ${i}`),
    );
    const doc = makeDoc(blocks);
    const { ctx, fillTexts } = createStubContext();

    renderPageFrameThumbnail(doc, ctx, { width: 500, maxHeight: 400 }, PALETTE);

    // Bounded: far fewer paragraphs drawn than the 2000 in the doc, and the
    // last drawn line sits near (not far past) maxHeight.
    expect(fillTexts.length).toBeLessThan(40);
    const lastY = fillTexts[fillTexts.length - 1].y;
    expect(lastY).toBeLessThan(500);
  });
});
