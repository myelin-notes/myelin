import { lazy, Suspense } from 'react';

/**
 * Tiny client island that lazy-loads the heavy canvas editor. This is a real
 * Astro island (mounted with `client:only`), which is what makes the dev server
 * inject React Fast Refresh's preamble. A manual `createRoot` mount skips that
 * and breaks `astro dev`, so the editor must come through here.
 */

// Started at module scope, not inside the component: the editor is by far the
// largest chunk on the page, and waiting for React to mount and an effect to
// run put its request behind three serial hops. This kicks it off as soon as
// this chunk parses, in parallel with React itself. `lazy` is handed the
// already-running promise rather than the importer so it cannot defer it again.
const editorModule = import('./CanvasEditor');
const Editor = lazy(() => editorModule);

export default function CanvasIsland() {
  return (
    <Suspense fallback={null}>
      <Editor />
    </Suspense>
  );
}
