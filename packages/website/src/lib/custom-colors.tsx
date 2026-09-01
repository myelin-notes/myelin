import { type PropsWithChildren, useCallback, useMemo, useState } from 'react';
import { CustomColorsContext } from '@myelin/editor/custom-colors';
import type { CustomColorTool } from '@myelin/editor/sync/repo/types';
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

function getStorageKey(tool: CustomColorTool): string {
  return tool === 'pen' ? STORAGE_KEY : `${STORAGE_KEY}-${tool}`;
}

function loadColors(tool: CustomColorTool): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(getStorageKey(tool));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveColors(tool: CustomColorTool, colors: string[]) {
  try {
    localStorage.setItem(getStorageKey(tool), JSON.stringify(colors));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function CustomColorsProvider({ children }: PropsWithChildren) {
  const promptLabel = useCopy().canvas.addCustomColor;
  const [colors, setColors] = useState<Record<CustomColorTool, string[]>>(
    () => ({
      pen: loadColors('pen'),
      highlighter: loadColors('highlighter'),
      text: loadColors('text'),
      folder: loadColors('folder'),
    }),
  );

  const addColor = useCallback(async (tool: CustomColorTool, color: string) => {
    setColors((prev) => {
      if (prev[tool].includes(color)) {
        return prev;
      }
      const next = [...prev[tool], color];
      saveColors(tool, next);
      return { ...prev, [tool]: next };
    });
  }, []);

  const removeColor = useCallback(
    async (tool: CustomColorTool, color: string) => {
      setColors((prev) => {
        const next = prev[tool].filter((c) => c !== color);
        saveColors(tool, next);
        return { ...prev, [tool]: next };
      });
    },
    [],
  );

  const promptAddColor = useCallback(
    (tool: CustomColorTool) => {
      const raw = window.prompt(promptLabel);
      if (!raw) {
        return;
      }
      const match = HEX_PATTERN.exec(raw.trim());
      if (match) {
        void addColor(tool, `#${match[1].toLowerCase()}`);
      }
    },
    [addColor, promptLabel],
  );

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
