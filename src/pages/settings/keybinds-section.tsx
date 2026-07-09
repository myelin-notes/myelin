import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  getActionCategory,
  getActionCopy,
  getActionIcon,
} from '@myelin/editor/keybinds/messages';
import { KEYBINDS_RESET_EVENT } from '@/lib/events';
import { useMessages } from '@/lib/i18n';
import { type Action, type KeyCombo, registry } from '@/lib/keybinds';
import { isApplePlatform } from '@/lib/platform';
import { cn } from '@/lib/utils';

function keyParts(combo: KeyCombo): string[] {
  const parts: string[] = [];
  if (combo.mod) {
    parts.push(isApplePlatform ? '⌘' : 'Ctrl');
  }
  if (combo.shift) {
    parts.push(isApplePlatform ? '⇧' : 'Shift');
  }
  if (combo.alt) {
    parts.push(isApplePlatform ? '⌥' : 'Alt');
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

      const mod = isApplePlatform ? e.metaKey : e.ctrlKey;
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
      className="flex h-8 min-w-20 items-center justify-center rounded-lg bg-accent-navy px-4 font-semibold text-[10px] text-text-on-dark uppercase tracking-widest outline-none"
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
}) {
  const strings = useMessages();
  const [capturing, setCapturing] = useState(false);
  const [currentCombo, setCurrentCombo] = useState(combo);
  const copy = getActionCopy(strings, action);
  const Icon = getActionIcon(action) ?? Keyboard;

  useEffect(() => {
    const onReset = () => setCurrentCombo(registry.getCombo(action));
    window.addEventListener(KEYBINDS_RESET_EVENT, onReset);
    return () => window.removeEventListener(KEYBINDS_RESET_EVENT, onReset);
  }, [action]);

  const handleCapture = (newCombo: KeyCombo) => {
    registry.rebind(action, newCombo);
    setCurrentCombo(newCombo);
    setCapturing(false);
  };

  return (
    <div className="group flex w-full items-center gap-3 rounded-xl bg-input/40 px-3 py-2.5 text-left ring-1 ring-border-subtle/70 transition-colors hover:bg-input sm:gap-4 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-text-secondary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm text-text-primary">
            {copy?.label ?? action}
          </span>
          {copy?.description && (
            <p className="text-text-muted text-xs">{copy.description}</p>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {capturing ? (
          <KeyCapture
            key="capture"
            onCapture={handleCapture}
            onCancel={() => setCapturing(false)}
          />
        ) : (
          <motion.button
            key="display"
            type="button"
            onClick={() => setCapturing(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="flex shrink-0 cursor-pointer flex-wrap items-center justify-end gap-1"
          >
            {currentCombo ? (
              keyParts(currentCombo).map((part, i) => (
                <span
                  key={i}
                  className={cn(
                    'flex h-7 items-center justify-center rounded-md border-border-key border-b-2 bg-bg-key font-bold text-text-secondary text-xs shadow-key',
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
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

export function KeybindsSection() {
  const strings = useMessages();
  const actions = registry.actions;

  const grouped = new Map<
    string,
    { action: Action; combo: KeyCombo | undefined }[]
  >();
  let hasAnyRebind = false;
  for (const action of actions) {
    const category = getActionCategory(strings, action);
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    if (registry.isRebound(action)) {
      hasAnyRebind = true;
    }
    grouped.get(category)!.push({
      action,
      combo: registry.getCombo(action),
    });
  }

  const handleResetAll = () => {
    registry.resetAll();
    window.dispatchEvent(new Event(KEYBINDS_RESET_EVENT));
  };

  return (
    <section id="keybinds" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">
          {strings.settings.keybinds.title}
        </h3>
        <button
          type="button"
          onClick={handleResetAll}
          disabled={!hasAnyRebind}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-text-muted text-xs ring-1 ring-border-subtle/70 transition-colors hover:bg-hover-tint hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
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
              {items.map(({ action, combo }) => (
                <KeybindRow key={action} action={action} combo={combo} />
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
    </section>
  );
}
