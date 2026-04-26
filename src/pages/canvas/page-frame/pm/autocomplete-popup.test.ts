import { describe, expect, it } from 'vitest';
import { getAutocompleteScrollTop } from './autocomplete-popup';

describe('getAutocompleteScrollTop', () => {
  it('keeps the current scroll position when the active item is already visible', () => {
    expect(
      getAutocompleteScrollTop(
        { clientHeight: 120, scrollTop: 40 } as HTMLElement,
        { offsetTop: 60, offsetHeight: 20 } as HTMLElement,
      ),
    ).toBe(40);
  });

  it('scrolls up when the active item is above the visible range', () => {
    expect(
      getAutocompleteScrollTop(
        { clientHeight: 120, scrollTop: 80 } as HTMLElement,
        { offsetTop: 24, offsetHeight: 20 } as HTMLElement,
      ),
    ).toBe(24);
  });

  it('scrolls down when the active item is below the visible range', () => {
    expect(
      getAutocompleteScrollTop(
        { clientHeight: 120, scrollTop: 40 } as HTMLElement,
        { offsetTop: 170, offsetHeight: 24 } as HTMLElement,
      ),
    ).toBe(74);
  });
});
