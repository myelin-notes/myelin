import { describe, expect, it, vi } from 'vitest';
import { removeStyleIfPresent, setStyleIfChanged } from './style-cache';

/**
 * A stand-in for an element's inline style declaration.
 *
 * Tests here run without a DOM, and what matters is not the resulting value —
 * asserting on that would pass even if every frame rewrote it — but whether a
 * write happened at all. A stub makes that directly countable.
 */
function fakeElement() {
  const values = new Map<string, string>();
  const setProperty = vi.fn((property: string, value: string) => {
    values.set(property, value);
  });
  const removeProperty = vi.fn((property: string) => {
    values.delete(property);
  });
  const style = {
    getPropertyValue: (property: string) => values.get(property) ?? '',
    setProperty,
    removeProperty,
  };
  return {
    element: { style } as unknown as HTMLElement,
    setProperty,
    removeProperty,
    values,
  };
}

describe('setStyleIfChanged', () => {
  it('applies a property that is not set yet', () => {
    const { element, values, setProperty } = fakeElement();
    setStyleIfChanged(element, 'width', '120px');
    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(values.get('width')).toBe('120px');
  });

  it('does not rewrite an identical value', () => {
    const { element, setProperty } = fakeElement();
    setStyleIfChanged(element, 'width', '120px');
    setStyleIfChanged(element, 'width', '120px');
    setStyleIfChanged(element, 'width', '120px');
    expect(setProperty).toHaveBeenCalledTimes(1);
  });

  it('writes again once the value actually changes', () => {
    const { element, values, setProperty } = fakeElement();
    setStyleIfChanged(element, 'transform', 'translate(0px, 0px)');
    setStyleIfChanged(element, 'transform', 'translate(4px, 0px)');
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(values.get('transform')).toBe('translate(4px, 0px)');
  });

  it('treats an empty value as clearing, not as a no-op write', () => {
    const { element, setProperty } = fakeElement();
    setStyleIfChanged(element, 'pointer-events', '');
    expect(setProperty).not.toHaveBeenCalled();
  });
});

describe('removeStyleIfPresent', () => {
  it('clears a property that is set', () => {
    const { element, values, removeProperty } = fakeElement();
    setStyleIfChanged(element, 'width', '10px');
    removeStyleIfPresent(element, 'width');
    expect(removeProperty).toHaveBeenCalledTimes(1);
    expect(values.has('width')).toBe(false);
  });

  it('does not touch a property that was never set', () => {
    // The vertical page layout clears six properties every frame that are
    // almost always already absent; unguarded, each is still a style write.
    const { element, removeProperty } = fakeElement();
    removeStyleIfPresent(element, 'width');
    removeStyleIfPresent(element, 'column-gap');
    expect(removeProperty).not.toHaveBeenCalled();
  });

  it('clears only once when called repeatedly', () => {
    const { element, removeProperty } = fakeElement();
    setStyleIfChanged(element, 'overflow', 'visible');
    removeStyleIfPresent(element, 'overflow');
    removeStyleIfPresent(element, 'overflow');
    expect(removeProperty).toHaveBeenCalledTimes(1);
  });
});
