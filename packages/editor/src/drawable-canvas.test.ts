import { describe, expect, it, vi } from 'vitest';
import {
  canMoveElementOrderForSelection,
  type ElementOrderItem,
  MAX_CLEAN_FRAME_GAP_MS,
  moveElementOrderForSelection,
  shouldRepaintFrame,
} from './drawable-canvas';
import { ElementType } from './elements/element-type';

const order = (...items: Array<[string, ElementType]>): ElementOrderItem[] =>
  items.map(([uuid, type]) => ({ uuid, type }));

describe('shouldRepaintFrame', () => {
  const never = () => false;

  it('skips the frame when nothing changed', () => {
    expect(shouldRepaintFrame(false, 0, never)).toBe(false);
    expect(shouldRepaintFrame(false, MAX_CLEAN_FRAME_GAP_MS - 1, never)).toBe(
      false,
    );
  });

  it('paints when the canvas is dirty, without scanning elements', () => {
    const hasAnimatingSelection = vi.fn(() => false);
    expect(shouldRepaintFrame(true, 0, hasAnimatingSelection)).toBe(true);
    expect(hasAnimatingSelection).not.toHaveBeenCalled();
  });

  it('keeps painting while the selection ramp runs', () => {
    expect(shouldRepaintFrame(false, 0, () => true)).toBe(true);
  });

  it('paints once the clean-frame gap elapses, so a missed invalidate self-heals', () => {
    expect(shouldRepaintFrame(false, MAX_CLEAN_FRAME_GAP_MS, never)).toBe(true);
    expect(shouldRepaintFrame(false, MAX_CLEAN_FRAME_GAP_MS * 10, never)).toBe(
      true,
    );
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
