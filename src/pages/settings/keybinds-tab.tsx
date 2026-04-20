import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMessages } from '@/lib/i18n';
import { type Action, type KeyCombo, registry } from '@/lib/keybinds';
import { getActionCategory, getActionCopy } from '@/lib/keybinds/messages';
import { cn } from '@/lib/utils';

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

function keyParts(combo: KeyCombo): string[] {
  const parts: string[] = [];
  if (combo.mod) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (combo.shift) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (combo.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }
  const key =
    combo.key === ' '
      ? 'Space'
      : combo.key.length === 1
        ? combo.key.toUpperCase()
        : combo.key;
  parts.push(key);
  return parts;
}

function KeyCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (combo: KeyCombo) => void;
  onCancel: () => void;
}) {
  const strings = useMessages();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      // Ignore lone modifier presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const combo: KeyCombo = { key: e.key };
      if (mod) {
        combo.mod = true;
      }
      if (e.shiftKey) {
        combo.shift = true;
      }
      if (e.altKey) {
        combo.alt = true;
      }
      onCapture(combo);
    },
    [onCapture, onCancel],
  );

  return (
    <motion.div
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.95, opacity: 0 }}
      transition={{ duration: 0.1 }}
      className="flex h-8 min-w-20 items-center justify-center rounded-lg bg-accent-navy px-4 font-semibold text-[10px] text-white uppercase tracking-widest outline-none"
    >
      {strings.settings.keybinds.pressKey}
    </motion.div>
  );
}

function KeybindRow({
  action,
  combo,
}: {
  action: Action;
  combo: KeyCombo | undefined;
  isRebound: boolean;
}) {
  const strings = useMessages();
  const [capturing, setCapturing] = useState(false);
  const [currentCombo, setCurrentCombo] = useState(combo);
  const copy = getActionCopy(strings, action);

  useEffect(() => {
    const onReset = () => setCurrentCombo(registry.getCombo(action));
    window.addEventListener('keybinds-reset', onReset);
    return () => window.removeEventListener('keybinds-reset', onReset);
  }, [action]);

  const handleCapture = (newCombo: KeyCombo) => {
    registry.rebind(action, newCombo);
    setCurrentCombo(newCombo);
    setCapturing(false);
  };

  return (
    <button
      onClick={() => !capturing && setCapturing(true)}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-xl bg-input/40 px-3 py-2.5 text-left transition-colors hover:bg-hover-tint sm:gap-4 sm:px-4"
    >
      <div className="min-w-0 flex-1">
        <span className="text-sm text-text-primary">
          {copy?.label ?? action}
        </span>
        {copy?.description && (
          <p className="text-text-muted text-xs">{copy.description}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <AnimatePresence mode="wait">
          {capturing ? (
            <KeyCapture
              key="capture"
              onCapture={handleCapture}
              onCancel={() => setCapturing(false)}
            />
          ) : (
            <motion.div
              key="display"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="flex items-center gap-1"
            >
              {currentCombo ? (
                keyParts(currentCombo).map((part, i) => (
                  <span
                    key={i}
                    className={cn(
                      'flex h-7 items-center justify-center rounded-md border-stone-300/50 border-b-2 bg-stone-200/50 font-bold text-text-secondary text-xs shadow-[0_1px_0_rgba(0,0,0,0.04)]',
                      part.length === 1 ? 'w-9' : 'px-4',
                    )}
                  >
                    {part}
                  </span>
                ))
              ) : (
                <span className="text-text-muted text-xs">
                  {strings.settings.keybinds.unbound}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </button>
  );
}

export function KeybindsSection() {
  const strings = useMessages();
  const actions = registry.actions;

  const grouped = new Map<
    string,
    { action: Action; combo: KeyCombo | undefined; isRebound: boolean }[]
  >();
  for (const action of actions) {
    const category = getActionCategory(strings, action);
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push({
      action,
      combo: registry.getCombo(action),
      isRebound: registry.isRebound(action),
    });
  }

  const handleResetAll = () => {
    registry.resetAll();
    window.dispatchEvent(new Event('keybinds-reset'));
  };

  return (
    <>
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">
          {strings.settings.keybinds.title}
        </h3>
        <button
          type="button"
          onClick={handleResetAll}
          className="flex items-center gap-1.5 text-text-muted text-xs transition-colors hover:text-text-secondary"
        >
          <RotateCcw className="size-3" />
          {strings.settings.keybinds.resetAll}
        </button>
      </div>

      <div className="space-y-8">
        {[...grouped.entries()].map(([category, items]) => (
          <div key={category}>
            <div className="mb-2 flex items-center gap-2 px-4">
              <span className="h-px w-3 bg-text-muted/50" />
              <span className="font-semibold text-[10px] text-text-muted uppercase tracking-widest">
                {category}
              </span>
            </div>
            <div className="space-y-1.5">
              {items.map(({ action, combo, isRebound }) => (
                <KeybindRow
                  key={action}
                  action={action}
                  combo={combo}
                  isRebound={isRebound}
                />
              ))}
            </div>
          </div>
        ))}

        {actions.length === 0 && (
          <p className="py-8 text-center text-sm text-text-muted">
            {strings.settings.keybinds.empty}
          </p>
        )}
      </div>
    </>
  );
}
