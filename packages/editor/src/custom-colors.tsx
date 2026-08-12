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
import { useRepository } from './sync/repo-context';

export interface CustomColorsContextValue {
  colors: string[];
  addColor: (color: string) => Promise<void>;
  removeColor: (color: string) => Promise<void>;
  // Opens the color picker; on confirm, persists the chosen color to the repo
  // manifest and broadcasts it to every color menu in the app.
  promptAddColor: () => void;
  // True while the picker is open. Menus that self-dismiss on outside clicks
  // (e.g. the text floating toolbar) can use this to stay alive while the
  // picker — which portals outside their subtree — is in use.
  pickerOpen: boolean;
}

// Exported so hosts without a repository (e.g. the marketing website) can
// mount their own provider that the editor's toolbars still read from.
export const CustomColorsContext =
  createContext<CustomColorsContextValue | null>(null);
const logger = new Logger('CustomColors');

const INITIAL_PICKER_COLOR = '#3b82f6';

export function CustomColorsProvider({ children }: PropsWithChildren) {
  const repository = useRepository();
  const [colors, setColors] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repository
      .getCustomColors()
      .then((loaded) => {
        if (!cancelled) {
          setColors(loaded);
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
    async (color: string) => {
      const updated = await repository.addCustomColor(color);
      setColors(updated);
    },
    [repository],
  );

  const removeColor = useCallback(
    async (color: string) => {
      const updated = await repository.removeCustomColor(color);
      setColors(updated);
    },
    [repository],
  );

  const promptAddColor = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const onConfirm = useCallback(
    (hex: string) => {
      setPickerOpen(false);
      void addColor(hex).catch((error) => {
        logger.error('Failed to add custom color', error);
      });
    },
    [addColor],
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

export function useCustomColors(): CustomColorsContextValue {
  const context = useContext(CustomColorsContext);
  if (!context) {
    throw new Error(
      'useCustomColors must be used within a CustomColorsProvider.',
    );
  }
  return context;
}
