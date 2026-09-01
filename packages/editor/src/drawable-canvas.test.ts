import { describe, expect, it } from 'vitest';
import {
  canMoveElementOrderForSelection,
  coalescedPointerSamples,
  type ElementOrderItem,
  moveElementOrderForSelection,
} from './drawable-canvas';
import { ElementType } from './elements/element-type';

const order = (...items: Array<[string, ElementType]>): ElementOrderItem[] =>
  items.map(([uuid, type]) => ({ uuid, type }));

describe('coalescedPointerSamples', () => {
  const event = (
    timeStamp: number,
    getCoalescedEvents?: () => PointerEvent[],
  ): PointerEvent =>
    ({ timeStamp, getCoalescedEvents }) as unknown as PointerEvent;

  it('returns every batched sample so a long frame keeps the whole stroke', () => {
    const batch = [event(110), event(120), event(130)];
    const delivered = event(130, () => batch);

    expect(coalescedPointerSamples(delivered, 100)).toEqual(batch);
  });

  it('uses only the delivered event while frames arrive on time', () => {
    const batch = [event(104), event(108)];
    const delivered = event(108, () => batch);

    expect(coalescedPointerSamples(delivered, 100)).toEqual([delivered]);
  });

  it('falls back to the delivered event when coalescing is unsupported', () => {
    const delivered = event(130);

    expect(coalescedPointerSamples(delivered, 100)).toEqual([delivered]);
  });

  it('falls back to the delivered event when the batch is empty', () => {
    const delivered = event(130, () => []);

    expect(coalescedPointerSamples(delivered, 100)).toEqual([delivered]);
  });
});

describe('moveElementOrderForSelection', () => {
  it('moves a selected element higher or lower by one step', () => {
    const items = order(
      ['frame', ElementType.PAGE_FRAME],
      ['a', ElementType.STROKE],
      ['b', ElementType.IMAGE],
      ['c', ElementType.TEXT],
    );

    expect(moveElementOrderForSelection(items, ['a'], 'higher')).toEqual([
      'frame',
      'b',
      'a',
      'c',
    ]);
    expect(moveElementOrderForSelection(items, ['b'], 'lower')).toEqual([
      'frame',
      'b',
      'a',
      'c',
    ]);
  });

  it('moves a multi-selection as one visual block', () => {
    const items = order(
      ['frame', ElementType.PAGE_FRAME],
      ['a', ElementType.STROKE],
      ['b', ElementType.IMAGE],
      ['c', ElementType.TEXT],
    );

    expect(moveElementOrderForSelection(items, ['a', 'b'], 'higher')).toEqual([
      'frame',
      'c',
      'a',
      'b',
    ]);
    expect(moveElementOrderForSelection(items, ['b', 'c'], 'lower')).toEqual([
      'frame',
      'b',
      'c',
      'a',
    ]);
  });

  it('shifts each selected element independently when selection is discontiguous', () => {
    const items = order(
      ['a', ElementType.STROKE],
      ['b', ElementType.STROKE],
      ['c', ElementType.STROKE],
      ['d', ElementType.STROKE],
    );

    expect(moveElementOrderForSelection(items, ['a', 'c'], 'higher')).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
    expect(moveElementOrderForSelection(items, ['b', 'd'], 'lower')).toEqual([
      'b',
      'a',
      'd',
      'c',
    ]);
  });

  it('keeps background elements behind foreground elements', () => {
    const items = order(
      ['frame', ElementType.PAGE_FRAME],
      ['pdf', ElementType.PDF],
      ['stroke', ElementType.STROKE],
    );

    expect(canMoveElementOrderForSelection(items, ['pdf'], 'higher')).toBe(
      false,
    );
    expect(moveElementOrderForSelection(items, ['pdf'], 'higher')).toEqual([
      'frame',
      'pdf',
      'stroke',
    ]);
  });
});
