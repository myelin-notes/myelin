import { type ComponentType, useEffect, useRef, useState } from 'react';

/**
 * Tiny client island that lazy-loads the heavy canvas editor. This is a real
 * Astro island (mounted with `client:only`), which is what makes the dev server
 * inject React Fast Refresh's preamble. A manual `createRoot` mount skips that
 * and breaks `astro dev`, so the editor must come through here.
 */
export default function CanvasIsland() {
  const [Editor, setEditor] = useState<ComponentType | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    import('./CanvasEditor').then((module) => {
      setEditor(() => module.default);
    });
  }, []);

  return Editor ? <Editor /> : null;
}
