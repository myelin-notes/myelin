import { describe, expect, it, vi } from 'vitest';
import { removeStyleIfPresent, setStyleIfChanged } from './style-cache';

function fakeElement() {
  const setProperty = vi.fn();
  const removeProperty = vi.fn();
  const element = {
    style: { setProperty, removeProperty },
  } as unknown as HTMLElement;
  return { element, setProperty, removeProperty };
}

describe('setStyleIfChanged', () => {
  it('writes the first time and skips an identical repeat', () => {
    const { element, setProperty } = fakeElement();

    setStyleIfChanged(element, 'column-width', '600px');
    setStyleIfChanged(element, 'column-width', '600px');
    setStyleIfChanged(element, 'column-width', '600px');

    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledWith('column-width', '600px');
  });

  it('writes again once the value actually changes', () => {
    const { element, setProperty } = fakeElement();

    setStyleIfChanged(element, 'width', '100px');
    setStyleIfChanged(element, 'width', '200px');
    setStyleIfChanged(element, 'width', '200px');

    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(setProperty).toHaveBeenLastCalledWith('width', '200px');
  });

  it('tracks each property independently', () => {
    const { element, setProperty } = fakeElement();

    setStyleIfChanged(element, 'width', '10px');
    setStyleIfChanged(element, 'height', '10px');

    expect(setProperty).toHaveBeenCalledTimes(2);
  });

  it('does not share state between elements', () => {
    const a = fakeElement();
    const b = fakeElement();

    setStyleIfChanged(a.element, 'width', '10px');
    setStyleIfChanged(b.element, 'width', '10px');

    expect(a.setProperty).toHaveBeenCalledTimes(1);
    expect(b.setProperty).toHaveBeenCalledTimes(1);
  });
});

describe('removeStyleIfPresent', () => {
  it('removes once, then skips', () => {
    const { element, removeProperty } = fakeElement();

    removeStyleIfPresent(element, 'overflow');
    removeStyleIfPresent(element, 'overflow');

    expect(removeProperty).toHaveBeenCalledTimes(1);
    expect(removeProperty).toHaveBeenCalledWith('overflow');
  });

  it('round-trips between set and remove', () => {
    const { element, setProperty, removeProperty } = fakeElement();

    setStyleIfChanged(element, 'overflow', 'visible');
    removeStyleIfPresent(element, 'overflow');
    setStyleIfChanged(element, 'overflow', 'visible');

    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(removeProperty).toHaveBeenCalledTimes(1);
  });
});
