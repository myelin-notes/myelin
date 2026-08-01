/**
 * Last value written to each tracked inline style property, per element.
 *
 * The page-frame DOM layer restyles its elements on every animation frame of a
 * pan or zoom. In WebKit an inline-style assignment dirties style — and for
 * geometric properties, layout — even when the value is byte-identical, and
 * during a pan almost every value in that path is unchanged. The multi-column
 * properties on the ProseMirror root are the expensive case: rewriting
 * `column-width` re-runs multi-column layout across the whole document.
 *
 * Every write to a property tracked this way must go through
 * {@link setStyleIfChanged} / {@link removeStyleIfPresent}, or the cache and the
 * DOM drift apart and a write that was needed gets skipped. Styles applied once
 * at element creation are safe to leave alone: an entry is only ever consulted
 * after this module itself wrote it.
 */
const writtenStyles = new WeakMap<HTMLElement, Map<string, string | null>>();

function styleCacheFor(element: HTMLElement): Map<string, string | null> {
  let cache = writtenStyles.get(element);
  if (!cache) {
    cache = new Map();
    writtenStyles.set(element, cache);
  }
  return cache;
}

/**
 * Set an inline style property, skipping the write when it would not change.
 * `property` is CSS-cased (`column-width`, not `columnWidth`).
 */
export function setStyleIfChanged(
  element: HTMLElement,
  property: string,
  value: string,
): void {
  const cache = styleCacheFor(element);
  if (cache.get(property) === value) {
    return;
  }
  cache.set(property, value);
  element.style.setProperty(property, value);
}

/** Remove an inline style property, skipping the write when already removed. */
export function removeStyleIfPresent(
  element: HTMLElement,
  property: string,
): void {
  const cache = styleCacheFor(element);
  if (cache.get(property) === null) {
    return;
  }
  cache.set(property, null);
  element.style.removeProperty(property);
}
