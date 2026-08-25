import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Logger } from '@myelin/shared/logger';
import { ColorPickerDialog } from './components/color-picker-dialog';
import type { CustomColorTool } from './sync/repo/types';
import { useRepository } from './sync/repo-context';

export interface CustomColorsContextValue {
  colors: Record<CustomColorTool, string[]>;
  addColor: (tool: CustomColorTool, color: string) => Promise<void>;
  removeColor: (tool: CustomColorTool, color: string) => Promise<void>;
  // Opens the color picker; on confirm, persists the chosen color to the
  // matching tool's list in the repo manifest.
  promptAddColor: (tool: CustomColorTool) => void;
  // True while the picker is open. Menus that self-dismiss on outside clicks
  // (e.g. the text floating toolbar) can use this to stay alive while the
  // picker — which portals outside their subtree — is in use.
  pickerOpen: boolean;
}

export interface ToolCustomColorsContextValue {
  colors: string[];
  // False once this tool's list is full. Callers drop their add affordance
  // rather than letting a user pick a color that has nowhere to go.
  canAddColor: boolean;
  addColor: (color: string) => Promise<void>;
  removeColor: (color: string) => Promise<void>;
  promptAddColor: () => void;
  pickerOpen: boolean;
}

// Exported so hosts without a repository (e.g. the marketing website) can
// mount their own provider that the editor's toolbars still read from.
export const CustomColorsContext =
  createContext<CustomColorsContextValue | null>(null);
const logger = new Logger('CustomColors');

const INITIAL_PICKER_COLOR = '#3b82f6';

/** Custom swatches a single tool may keep. Deleting one frees a slot. */
export const MAX_CUSTOM_COLORS = 8;

export function CustomColorsProvider({ children }: PropsWithChildren) {
  const repository = useRepository();
  const [colors, setColors] = useState<Record<CustomColorTool, string[]>>({
    pen: [],
    highlighter: [],
    text: [],
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTool, setPickerTool] = useState<CustomColorTool>('pen');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      repository.getCustomColors('pen'),
      repository.getCustomColors('highlighter'),
      repository.getCustomColors('text'),
    ])
      .then(([pen, highlighter, text]) => {
        if (!cancelled) {
          setColors({ pen, highlighter, text });
        }
      })
      .catch((error) => {
        logger.error('Failed to load custom colors', error);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const addColor = useCallback(
    async (tool: CustomColorTool, color: string) => {
      const updated = await repository.addCustomColor(color, tool);
      setColors((current) => ({ ...current, [tool]: updated }));
    },
    [repository],
  );

  const removeColor = useCallback(
    async (tool: CustomColorTool, color: string) => {
      const updated = await repository.removeCustomColor(color, tool);
      setColors((current) => ({ ...current, [tool]: updated }));
    },
    [repository],
  );

  const promptAddColor = useCallback((tool: CustomColorTool) => {
    setPickerTool(tool);
    setPickerOpen(true);
  }, []);

  const onConfirm = useCallback(
    (hex: string) => {
      setPickerOpen(false);
      void addColor(pickerTool, hex).catch((error) => {
        logger.error('Failed to add custom color', error);
      });
    },
    [addColor, pickerTool],
  );

  const onCancel = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const value = useMemo(
    () => ({ colors, addColor, removeColor, promptAddColor, pickerOpen }),
    [colors, addColor, removeColor, promptAddColor, pickerOpen],
  );

  return (
    <CustomColorsContext.Provider value={value}>
      {children}
      <ColorPickerDialog
        open={pickerOpen}
        initialColor={INITIAL_PICKER_COLOR}
        title="Custom color"
        confirmLabel="Add color"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </CustomColorsContext.Provider>
  );
}

export function useCustomColors(
  tool: CustomColorTool,
): ToolCustomColorsContextValue {
  const context = useContext(CustomColorsContext);
  if (!context) {
    throw new Error(
      'useCustomColors must be used within a CustomColorsProvider.',
    );
  }
  const addColor = useCallback(
    (color: string) => context.addColor(tool, color),
    [context, tool],
  );
  const removeColor = useCallback(
    (color: string) => context.removeColor(tool, color),
    [context, tool],
  );
  const promptAddColor = useCallback(
    () => context.promptAddColor(tool),
    [context, tool],
  );

  return useMemo(
    () => ({
      colors: context.colors[tool],
      canAddColor: context.colors[tool].length < MAX_CUSTOM_COLORS,
      addColor,
      removeColor,
      promptAddColor,
      pickerOpen: context.pickerOpen,
    }),
    [
      addColor,
      context.colors,
      context.pickerOpen,
      promptAddColor,
      removeColor,
      tool,
    ],
  );
}
