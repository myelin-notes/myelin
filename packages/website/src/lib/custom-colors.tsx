import { type PropsWithChildren, useCallback, useMemo, useState } from 'react';
import { CustomColorsContext } from '@myelin/editor/custom-colors';
import { useCopy } from '@/content/copy-context';

/**
 * Repository-free stand-in for the app's custom-colors provider. The app
 * version (`@myelin/editor/custom-colors`) persists colors to the workspace
 * repository via `useRepository`, which the marketing site has no provider
 * for. Here we keep custom colors in localStorage and feed the editor's own
 * context, so the editor's toolbars (e.g. the page-frame floating toolbar)
 * and the site's tool-options panel share the same swatches.
 */

const STORAGE_KEY = 'myelin-web-custom-colors';
const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

function loadColors(): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveColors(colors: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function CustomColorsProvider({ children }: PropsWithChildren) {
  const promptLabel = useCopy().canvas.addCustomColor;
  const [colors, setColors] = useState<string[]>(loadColors);

  const addColor = useCallback(async (color: string) => {
    setColors((prev) => {
      if (prev.includes(color)) {
        return prev;
      }
      const next = [...prev, color];
      saveColors(next);
      return next;
    });
  }, []);

  const removeColor = useCallback(async (color: string) => {
    setColors((prev) => {
      const next = prev.filter((c) => c !== color);
      saveColors(next);
      return next;
    });
  }, []);

  const promptAddColor = useCallback(() => {
    const raw = window.prompt(promptLabel);
    if (!raw) {
      return;
    }
    const match = HEX_PATTERN.exec(raw.trim());
    if (match) {
      void addColor(`#${match[1].toLowerCase()}`);
    }
  }, [addColor, promptLabel]);

  const value = useMemo(
    () => ({
      colors,
      addColor,
      removeColor,
      promptAddColor,
      pickerOpen: false,
    }),
    [colors, addColor, removeColor, promptAddColor],
  );

  return (
    <CustomColorsContext.Provider value={value}>
      {children}
    </CustomColorsContext.Provider>
  );
}

export { useCustomColors } from '@myelin/editor/custom-colors';
