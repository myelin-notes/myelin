/**
 * Same-value guards for inline styles written every animation frame.
 *
 * Assigning to `element.style` dirties style even when the value is identical, and for geometry
 * properties (`width`, `height`, `zoom`) that invalidates layout. The page-frame sync loop rewrites
 * a page's whole geometry every frame, so unguarded it relaid out the entire ProseMirror document
 * on every frame of a pan — for values that only change on zoom.
 *
 * `style.getPropertyValue` is cheap: it reads the element's own inline declaration and does not
 * flush layout, unlike `getComputedStyle`.
 */

/** Write `value` only if the element's inline style does not already say so. */
export function setStyleIfChanged(
  element: HTMLElement,
  property: string,
  value: string,
): void {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
}

/** Clear `property` only if the element actually has it set inline. */
export function removeStyleIfPresent(
  element: HTMLElement,
  property: string,
): void {
  if (element.style.getPropertyValue(property) !== '') {
    element.style.removeProperty(property);
  }
}
