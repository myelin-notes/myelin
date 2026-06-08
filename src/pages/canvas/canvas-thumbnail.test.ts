import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawableElement } from './elements/drawable-element';

class TestDOMRect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}

  get left() {
    return Math.min(this.x, this.x + this.width);
  }

  get right() {
    return Math.max(this.x, this.x + this.width);
  }

  get top() {
    return Math.min(this.y, this.y + this.height);
  }

  get bottom() {
    return Math.max(this.y, this.y + this.height);
  }
}

vi.stubGlobal('DOMRect', TestDOMRect);

const toBlob = vi.fn(async () => new Blob());
const release = vi.fn();
const context = {
  imageSmoothingQuality: 'low' as ImageSmoothingQuality,
  scale: vi.fn(),
  translate: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
};

vi.mock('@/lib/scratch-canvas', () => ({
  getScratchCanvasContext: vi.fn(() => ({ context, toBlob, release })),
}));

interface FakeElement {
  offset: { x: number; y: number };
  scale: { x: number; y: number };
  hidden: boolean;
  boundingBox: DOMRect;
  prepareThumbnail: ReturnType<typeof vi.fn>;
  drawThumbnail: ReturnType<typeof vi.fn>;
}

function makeElement(overrides: Partial<FakeElement> = {}): FakeElement {
  return {
    offset: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    hidden: false,
    boundingBox: new DOMRect(0, 0, 100, 100),
    prepareThumbnail: vi.fn(async () => {}),
    drawThumbnail: vi.fn(),
    ...overrides,
  };
}

function asElements(elements: FakeElement[]): readonly DrawableElement[] {
  return elements as unknown as readonly DrawableElement[];
}

async function importRender() {
  return (await import('./canvas-thumbnail')).renderCanvasThumbnail;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('renderCanvasThumbnail', () => {
  it('returns null for empty input', async () => {
    const renderCanvasThumbnail = await importRender();
    const result = await renderCanvasThumbnail(
      asElements([]),
      new DOMRect(0, 0, 100, 100),
      600,
    );
    expect(result).toBeNull();
  });

  it('returns null for zero-size content bounds', async () => {
    const renderCanvasThumbnail = await importRender();
    const result = await renderCanvasThumbnail(
      asElements([makeElement()]),
      new DOMRect(0, 0, 0, 0),
      600,
    );
    expect(result).toBeNull();
  });

  it('draws elements in order', async () => {
    const renderCanvasThumbnail = await importRender();
    const order: number[] = [];
    const first = makeElement({
      drawThumbnail: vi.fn(() => order.push(1)),
    });
    const second = makeElement({
      drawThumbnail: vi.fn(() => order.push(2)),
    });

    await renderCanvasThumbnail(
      asElements([first, second]),
      new DOMRect(0, 0, 100, 100),
      600,
    );

    expect(order).toEqual([1, 2]);
  });

  it('skips hidden elements', async () => {
    const renderCanvasThumbnail = await importRender();
    const visible = makeElement();
    const hidden = makeElement({ hidden: true });

    await renderCanvasThumbnail(
      asElements([visible, hidden]),
      new DOMRect(0, 0, 100, 100),
      600,
    );

    expect(visible.drawThumbnail).toHaveBeenCalledTimes(1);
    expect(hidden.drawThumbnail).not.toHaveBeenCalled();
    expect(hidden.prepareThumbnail).not.toHaveBeenCalled();
  });

  it('awaits prepareThumbnail before drawing any element', async () => {
    const renderCanvasThumbnail = await importRender();
    const events: string[] = [];
    const element = makeElement({
      prepareThumbnail: vi.fn(async () => {
        await Promise.resolve();
        events.push('prepared');
      }),
      drawThumbnail: vi.fn(() => events.push('drawn')),
    });

    await renderCanvasThumbnail(
      asElements([element]),
      new DOMRect(0, 0, 100, 100),
      600,
    );

    expect(events).toEqual(['prepared', 'drawn']);
  });

  it('releases the scratch canvas', async () => {
    const renderCanvasThumbnail = await importRender();
    await renderCanvasThumbnail(
      asElements([makeElement()]),
      new DOMRect(0, 0, 100, 100),
      600,
    );
    expect(release).toHaveBeenCalledTimes(1);
  });
});
