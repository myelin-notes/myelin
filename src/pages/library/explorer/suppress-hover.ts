/**
 * After a native HTML5 drag-and-drop, the browser does not re-evaluate
 * `:hover` until the pointer next moves. On drop the explorer list reflows
 * under a stationary cursor (the dragged item leaves its row), so whichever
 * item lands under the pointer picks up a phantom hover highlight that looks
 * like a random selection. Disabling pointer events on the body until the
 * pointer actually moves forces hover to recompute from the real cursor.
 */
let active = false;

export function suppressHoverUntilPointerMove() {
  if (active) {
    return;
  }
  active = true;
  document.body.classList.add('dnd-suppress-hover');

  const clear = () => {
    active = false;
    document.body.classList.remove('dnd-suppress-hover');
    window.removeEventListener('pointermove', clear);
    window.removeEventListener('pointerdown', clear);
    window.removeEventListener('wheel', clear);
  };

  window.addEventListener('pointermove', clear);
  window.addEventListener('pointerdown', clear);
  window.addEventListener('wheel', clear);
}
