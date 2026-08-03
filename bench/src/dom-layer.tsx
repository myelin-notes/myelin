import { createRoot, type Root } from 'react-dom/client';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { I18nProvider } from '@myelin/editor/i18n';
import { PageFrameDomLayer } from '@myelin/editor/page-frame/dom-layer';

/**
 * Mount the app's page-frame DOM layer over the bench canvas.
 *
 * This is the largest thing the app has that the canvas-only bench does not: a
 * React tree that runs its own per-frame sync loop, writing CSS transforms for
 * every page and hosting a ProseMirror editor per frame. The canvas renderer
 * alone measured faster on-device than the real app does, so the difference has
 * to be somewhere, and this is the first place to look.
 *
 * Rendered with `editingElement` null — no page is in edit mode. That is the
 * state the app sits in while you pan around a note, which is the case being
 * measured.
 */
export function mountPageFrameDomLayer(
  host: HTMLElement,
  canvas: DrawableCanvas,
): Root {
  const root = createRoot(host);
  root.render(
    <I18nProvider>
      <PageFrameDomLayer
        canvasRef={{ current: canvas }}
        editingElement={null}
      />
    </I18nProvider>,
  );
  return root;
}
