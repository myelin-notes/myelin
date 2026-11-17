import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import type { HandwritingStroke } from '@/platform/tauri/handwriting';
import { collectHandwritingSources } from './handwriting';

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

describe('collectHandwritingSources', () => {
  beforeEach(() => {
    recognizeHandwriting.mockReset();
  });

  it('recognizes a paragraph as one block and only re-sends new ink', async () => {
    const paragraph = [
      letter('p-a', 0, 0),
      letter('p-b', 10, 0),
      // Next word, then next line.
      letter('p-c', 28, 0),
      letter('p-d', 0, 35),
    ];
    const farNote = letter('far', 500, 0);
    recognizeHandwriting.mockResolvedValueOnce(['first para', 'far note']);

    const first = await collectHandwritingSources(
      canvasOf(...paragraph, farNote),
    );

    expect(recognizeHandwriting.mock.calls[0][0]).toHaveLength(2);
    expect(
      first.map(({ text, selectUuids }) => ({ text, selectUuids })),
    ).toEqual([
      { text: 'first para', selectUuids: ['p-a', 'p-b', 'p-c', 'p-d'] },
      { text: 'far note', selectUuids: ['far'] },
    ]);

    const added = letter('added', 0, 500);
    recognizeHandwriting.mockResolvedValueOnce(['new ink']);
    const second = await collectHandwritingSources(
      canvasOf(...paragraph, farNote, added),
    );

    const [sentBlocks] = recognizeHandwriting.mock.calls[1];
    expect(sentBlocks).toEqual([[{ points: [0, 500, 0, 520], width: 2 }]]);
    expect(second.map((source) => source.text)).toEqual([
      'first para',
      'far note',
      'new ink',
    ]);
  });

  it('returns no sources when the platform has no recognizer', async () => {
    recognizeHandwriting.mockRejectedValueOnce(new Error('unavailable'));

    await expect(
      collectHandwritingSources(canvasOf(letter('unsupported', 0, 0))),
    ).resolves.toEqual([]);
  });
});
