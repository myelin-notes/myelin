import { lazy, Suspense } from 'react';
import type { Locale } from '@/lib/locale';

/**
 * Tiny client island that lazy-loads the heavy canvas editor. This is a real
 * Astro island (mounted with `client:only`), which is what makes the dev server
 * inject React Fast Refresh's preamble. A manual `createRoot` mount skips that
 * and breaks `astro dev`, so the editor must come through here.
 */

/** Long enough that a slow connection still wins the race; short enough that a
 *  genuinely failed load does not strand the visitor on a blank page. */
const EDITOR_LOAD_TIMEOUT_MS = 15_000;

function revealStaticSite(): void {
  document.documentElement.classList.remove('canvas-env');
}

// The gate in Base.astro decided this before first paint; touch and narrow
// viewports get the static page, so they must never request the editor chunk.
const isCanvasEnv = document.documentElement.classList.contains('canvas-env');

// Started at module scope, not inside the component: the editor is by far the
// largest chunk on the page, and waiting for React to mount and an effect to
// run put its request behind three serial hops. This kicks it off as soon as
// this chunk parses, in parallel with React itself. `lazy` is handed the
// already-running promise rather than the importer so it cannot defer it again.
const editorModule = isCanvasEnv ? import('./CanvasEditor') : null;
const Editor = editorModule ? lazy(() => editorModule) : null;

if (editorModule) {
  // A stale chunk hash after a deploy, or a connection that dies mid-download,
  // would otherwise leave a blank page with no way back — the static site is
  // hidden and the canvas never arrives. Fall back to the static page instead.
  const failsafe = setTimeout(revealStaticSite, EDITOR_LOAD_TIMEOUT_MS);
  editorModule.then(() => clearTimeout(failsafe), revealStaticSite);
}

export default function CanvasIsland({ locale }: { locale: Locale }) {
  if (!Editor) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <Editor locale={locale} />
    </Suspense>
  );
}
