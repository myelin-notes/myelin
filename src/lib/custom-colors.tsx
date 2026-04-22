import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { HexColorPicker } from 'react-colorful';
import { createPortal } from 'react-dom';
import { Logger } from './logger';
import { useRepository } from './sync';

interface CustomColorsContextValue {
  colors: string[];
  addColor: (color: string) => Promise<void>;
  // Opens the color picker; on confirm, persists the chosen color to the repo
  // manifest and broadcasts it to every color menu in the app.
  promptAddColor: () => void;
  // True while the picker is open. Menus that self-dismiss on outside clicks
  // (e.g. the text floating toolbar) can use this to stay alive while the
  // picker — which portals outside their subtree — is in use.
  pickerOpen: boolean;
}

const CustomColorsContext = createContext<CustomColorsContextValue | null>(
  null,
);
const logger = new Logger('CustomColors');

const INITIAL_PICKER_COLOR = '#3b82f6';
const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

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
    () => ({ colors, addColor, promptAddColor, pickerOpen }),
    [colors, addColor, promptAddColor, pickerOpen],
  );

  return (
    <CustomColorsContext.Provider value={value}>
      {children}
      {createPortal(
        <AnimatePresence>
          {pickerOpen && (
            <ColorPickerDialog
              key="custom-color-picker"
              initialColor={INITIAL_PICKER_COLOR}
              onConfirm={onConfirm}
              onCancel={onCancel}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </CustomColorsContext.Provider>
  );
}

interface ColorPickerDialogProps {
  initialColor: string;
  onConfirm: (hex: string) => void;
  onCancel: () => void;
}

function ColorPickerDialog({
  initialColor,
  onConfirm,
  onCancel,
}: ColorPickerDialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState<string>(initialColor);
  const [hexInput, setHexInput] = useState<string>(initialColor);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm(hex);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, onConfirm, hex]);

  // Click outside the panel dismisses. Capture phase so we beat other
  // document-level pointerdown listeners (e.g. the floating toolbar's).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onCancel]);

  const onPickerChange = useCallback((next: string) => {
    setHex(next);
    setHexInput(next);
  }, []);

  const onHexInputChange = useCallback((raw: string) => {
    setHexInput(raw);
    const match = HEX_PATTERN.exec(raw.trim());
    if (match) {
      setHex(`#${match[1].toLowerCase()}`);
    }
  }, []);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -4, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -2, scale: 0.98 }}
      transition={{ duration: 0.14, ease: [0.25, 0.1, 0.25, 1] }}
      className="pointer-events-auto fixed top-1/2 left-1/2 z-[200] w-[240px] origin-center -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover/90 p-3 shadow-ambient backdrop-blur-2xl"
      style={{ border: '0.5px solid var(--border-ghost)' }}
      role="dialog"
      aria-label="Custom color"
    >
      <div className="flex items-center justify-between pb-2">
        <span className="select-none font-bold text-[10px] text-text-muted uppercase tracking-[0.1em]">
          Custom color
        </span>
        <div
          className="size-4 rounded-md transition-colors duration-150"
          style={{
            backgroundColor: hex,
            boxShadow:
              'inset 0 0 0 1px rgba(25,28,30,0.08), 0 0 0 2px rgba(255,255,255,0.6)',
          }}
        />
      </div>

      <HexColorPicker
        color={hex}
        onChange={onPickerChange}
        className="myelin-color-picker"
      />

      <div className="mt-3 flex items-center gap-2">
        <span className="select-none font-medium text-[10px] text-text-muted uppercase tracking-[0.08em]">
          Hex
        </span>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => onHexInputChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="h-6 flex-1 rounded-md border-none bg-surface px-2 font-medium text-[12px] text-text-primary outline-none transition-colors focus:bg-white"
          style={{
            boxShadow: 'inset 0 0 0 0.5px var(--border-ghost)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="h-7 cursor-pointer rounded-lg border-none bg-transparent px-2.5 font-medium text-[12px] text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(hex)}
          className="h-7 cursor-pointer rounded-lg border-none bg-gradient-to-b from-accent-dark to-primary-container px-3 font-medium text-[12px] text-text-on-dark shadow-sm transition-transform duration-100 hover:scale-[1.02] active:scale-[0.98]"
        >
          Add color
        </button>
      </div>
    </motion.div>
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
