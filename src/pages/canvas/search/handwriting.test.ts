import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import type { HandwritingStroke } from '@/platform/tauri/handwriting';
import { HandwritingIndex } from './handwriting';

const recognizeHandwriting =
  vi.fn<(blocks: HandwritingStroke[][]) => Promise<string[]>>();
vi.mock('@/platform/tauri/handwriting', () => ({
  recognizeHandwriting: (blocks: HandwritingStroke[][]) =>
    recognizeHandwriting(blocks),
}));

// A 20-unit-tall vertical stroke, like one letter.
function letter(uuid: string, x: number, y: number): StrokeElement {
  const stroke = new StrokeElement(uuid, [], false, {
    color: '#000',
    size: 2,
  });
  stroke.addPoint(x, y, 0.5);
  stroke.addPoint(x, y + 20, 0.5);
  return stroke;
}

function canvasOf(...elements: StrokeElement[]): DrawableCanvas {
  return { elements } as unknown as DrawableCanvas;
}

function storeWith(saved: Record<string, string> = {}) {
  return {
    loadHandwritingText: vi.fn(async () => saved),
    saveHandwritingText: vi.fn(
      async (_id: string, _texts: Record<string, string>) => {},
    ),
  };
}

describe('HandwritingIndex', () => {
  beforeEach(() => {
    recognizeHandwriting.mockReset();
  });

  it('recognizes a paragraph as one block and only re-sends new ink', async () => {
    const paragraph = [
      letter('p-a', 0, 0),
      letter('p-b', 10, 0),
      // Next word, a widely spaced word, then the next line.
      letter('p-c', 28, 0),
      letter('p-e', 76, 0),
      letter('p-d', 0, 35),
    ];
    const farNote = letter('far', 500, 0);
    recognizeHandwriting.mockResolvedValueOnce(['first para', 'far note']);
    const index = new HandwritingIndex(storeWith(), 'note');

    const first = await index.collect(canvasOf(...paragraph, farNote));

    expect(recognizeHandwriting.mock.calls[0][0]).toHaveLength(2);
    expect(
      first.map(({ text, selectUuids }) => ({ text, selectUuids })),
    ).toEqual([
      {
        text: 'first para',
        selectUuids: ['p-a', 'p-b', 'p-c', 'p-e', 'p-d'],
      },
      { text: 'far note', selectUuids: ['far'] },
    ]);

    const added = letter('added', 0, 500);
    recognizeHandwriting.mockResolvedValueOnce(['new ink']);
    const second = await index.collect(canvasOf(...paragraph, farNote, added));

    const [sentBlocks] = recognizeHandwriting.mock.calls[1];
    expect(sentBlocks).toEqual([[{ points: [0, 500, 0, 520], width: 2 }]]);
    expect(second.map((source) => source.text)).toEqual([
      'first para',
      'far note',
      'new ink',
    ]);
  });

  it('reuses text saved by an earlier launch and drops erased blocks', async () => {
    const kept = letter('kept', 0, 0);
    const erased = letter('erased', 500, 0);
    const firstLaunch = storeWith();
    recognizeHandwriting.mockResolvedValueOnce(['kept', 'erased']);
    await new HandwritingIndex(firstLaunch, 'note').collect(
      canvasOf(kept, erased),
    );
    const [[, saved]] = firstLaunch.saveHandwritingText.mock.calls;

    const relaunch = storeWith(saved);
    const sources = await new HandwritingIndex(relaunch, 'note').collect(
      canvasOf(kept),
    );

    expect(recognizeHandwriting).toHaveBeenCalledTimes(1);
    expect(sources.map((source) => source.text)).toEqual(['kept']);
    expect(
      Object.values(relaunch.saveHandwritingText.mock.calls[0][1]),
    ).toEqual(['kept']);
  });

  it('returns no sources when the platform has no recognizer', async () => {
    recognizeHandwriting.mockRejectedValueOnce(new Error('unavailable'));

    await expect(
      new HandwritingIndex(storeWith(), 'note').collect(
        canvasOf(letter('unsupported', 0, 0)),
      ),
    ).resolves.toEqual([]);
  });
});
