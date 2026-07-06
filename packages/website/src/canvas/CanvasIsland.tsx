import { type ComponentType, useEffect, useRef, useState } from 'react';

/**
 * Tiny client island that lazy-loads the heavy canvas experience, but only on
 * desktop pointers. Phones and small windows keep the static notebook and never
 * download the engine.
 *
 * This is a real Astro island (mounted with `client:only`), which is what makes
 * the dev server inject React Fast Refresh's preamble. A manual `createRoot`
 * mount skips that and breaks `astro dev`, so the canvas must come through here.
 */
export default function CanvasIsland() {
  const [Experience, setExperience] = useState<ComponentType | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    if (!window.matchMedia('(min-width: 900px) and (pointer: fine)').matches) {
      return;
    }
    started.current = true;
    import('./CanvasExperience').then((module) => {
      setExperience(() => module.default);
    });
  }, []);

  return Experience ? <Experience /> : null;
}
