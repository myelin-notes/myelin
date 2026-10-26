import { describe, expect, it } from 'vitest';
import { planPdfTextMarks } from './text-layer';

describe('planPdfTextMarks', () => {
  it('splits matches across text-layer spans, last first', () => {
    // Spans "Hello Wo" + "rld", a <br>, then one span holding two matches.
    const pieces = ['Hello Wo', 'rld', '\n', 'world, world'];

    expect(planPdfTextMarks(pieces, 'WORLD', 2)).toEqual([
      { piece: 3, from: 7, to: 12, current: true },
      { piece: 3, from: 0, to: 5, current: false },
      { piece: 1, from: 0, to: 3, current: false },
      { piece: 0, from: 6, to: 8, current: false },
    ]);
  });
});
