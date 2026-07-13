import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

/**
 * Repository-free stand-in for the app's custom-colors context. The app version
 * (`@myelin/editor/custom-colors`) persists colors to the workspace repository
 * via `useRepository`, which the marketing site has no provider for. Here we
 * keep custom colors in localStorage so the toolbar's swatches keep working
 * without pulling in the app's sync layer.
 */
interface CustomColorsContextValue {
  colors: string[];
  addColor: (color: string) => Promise<void>;
  removeColor: (color: string) => Promise<void>;
  promptAddColor: () => void;
  pickerOpen: boolean;
}

const CustomColorsContext = createContext<CustomColorsContextValue | null>(
  null,
);

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
    const raw = window.prompt('Add a custom color (hex, e.g. #3b82f6)');
    if (!raw) {
      return;
    }
    const match = HEX_PATTERN.exec(raw.trim());
    if (match) {
      void addColor(`#${match[1].toLowerCase()}`);
    }
  }, [addColor]);

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

export function useCustomColors(): CustomColorsContextValue {
  const context = useContext(CustomColorsContext);
  if (!context) {
    throw new Error(
      'useCustomColors must be used within a CustomColorsProvider.',
    );
  }
  return context;
}
