export type DragItemKind = 'file' | 'folder';

const SVG_ATTRS =
  'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function iconMarkup(kind: DragItemKind): string {
  if (kind === 'folder') {
    return `<svg ${SVG_ATTRS} style="color: var(--color-accent-amber); fill: var(--color-accent-amber)"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
  }
  return `<svg ${SVG_ATTRS} style="color: var(--color-text-muted)"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;
}

/**
 * Builds an off-screen pill element to use as the drag ghost via
 * `dataTransfer.setDragImage`, and returns a cleanup to remove it once the
 * browser has snapshotted it. The element must stay in the DOM for the
 * duration of the dragstart handler, so callers schedule cleanup on the next
 * frame.
 */
export function createItemDragImage(
  name: string,
  kind: DragItemKind,
): { element: HTMLElement; cleanup: () => void } {
  const element = document.createElement('div');
  element.style.cssText = [
    'position: fixed',
    // Verified on macOS WKWebView: negative-coordinate placement snapshots
    // fine. Don't "fix" this to `top: 0` + `transform: translateX(-9999px)` —
    // that variant produces NO drag image at all there (the snapshot follows
    // the transformed paint position, so it captures nothing).
    'top: -1000px',
    'left: -1000px',
    'display: inline-flex',
    'align-items: center',
    'gap: 8px',
    'max-width: 280px',
    'padding: 7px 14px',
    'border-radius: 9999px',
    'background: var(--color-card)',
    'color: var(--color-text-primary)',
    'font-size: 13px',
    'font-weight: 500',
    'line-height: 1',
    'border: 1px solid var(--color-border-subtle)',
    'box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18)',
    'pointer-events: none',
    'z-index: 9999',
  ].join(';');

  const icon = document.createElement('span');
  icon.style.cssText = 'display: inline-flex; flex-shrink: 0';
  icon.innerHTML = iconMarkup(kind);

  const label = document.createElement('span');
  label.textContent = name;
  label.style.cssText =
    'overflow: hidden; text-overflow: ellipsis; white-space: nowrap';

  element.append(icon, label);
  document.body.appendChild(element);

  return {
    element,
    cleanup: () => element.remove(),
  };
}
