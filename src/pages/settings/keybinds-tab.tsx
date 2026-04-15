import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type Action,
  formatKeyCombo,
  type KeyCombo,
  registry,
} from '@/lib/keybinds';
import { cn } from '@/lib/utils';

function humanizeAction(action: string): { category: string; label: string } {
  const [ns, ...rest] = action.split(':');
  const label = rest
    .join(' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const category = ns.charAt(0).toUpperCase() + ns.slice(1);
  return { category, label };
}

function KeyCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (combo: KeyCombo) => void;
  onCancel: () => void;
}) {
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
      className="flex h-8 items-center justify-center rounded-lg bg-accent-navy px-4 font-semibold text-[10px] text-white uppercase tracking-widest outline-none"
    >
      Press a key&hellip;
    </motion.div>
  );
}

function KeybindRow({
  action,
  combo,
  isRebound,
}: {
  action: Action;
  combo: KeyCombo | undefined;
  isRebound: boolean;
}) {
  const [capturing, setCapturing] = useState(false);
  const [currentCombo, setCurrentCombo] = useState(combo);
  const [rebound, setRebound] = useState(isRebound);
  const { label } = humanizeAction(action);

  const handleCapture = (newCombo: KeyCombo) => {
    registry.rebind(action, newCombo);
    setCurrentCombo(newCombo);
    setRebound(true);
    setCapturing(false);
  };

  const handleReset = () => {
    registry.resetBinding(action);
    setCurrentCombo(registry.getCombo(action));
    setRebound(false);
  };

  return (
    <button
      type="button"
      onClick={() => !capturing && setCapturing(true)}
      className="group flex w-full cursor-pointer items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-hover-tint"
    >
      <span className="flex-1 text-sm text-text-primary">{label}</span>

      <div className="flex items-center gap-2">
        <AnimatePresence mode="wait">
          {capturing ? (
            <KeyCapture
              key="capture"
              onCapture={handleCapture}
              onCancel={() => setCapturing(false)}
            />
          ) : (
            <motion.span
              key="display"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className={cn(
                'flex h-8 items-center justify-center rounded-lg px-3 font-medium text-xs tracking-wide',
                currentCombo
                  ? 'bg-input text-text-secondary'
                  : 'bg-input text-text-muted',
              )}
            >
              {currentCombo ? formatKeyCombo(currentCombo) : 'Unbound'}
            </motion.span>
          )}
        </AnimatePresence>

        {rebound && !capturing && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReset();
                  }}
                />
              }
            >
              <RotateCcw className="size-3 text-text-muted" />
            </TooltipTrigger>
            <TooltipContent>Reset to default</TooltipContent>
          </Tooltip>
        )}
      </div>
    </button>
  );
}

export function KeybindsSection() {
  const actions = registry.actions;

  const grouped = new Map<
    string,
    { action: Action; combo: KeyCombo | undefined; isRebound: boolean }[]
  >();
  for (const action of actions) {
    const { category } = humanizeAction(action);
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
        <h3 className="font-heading text-xl">Keybinds</h3>
        <Button variant="ghost" size="xs" onClick={handleResetAll}>
          <RotateCcw className="size-3" />
          Reset All
        </Button>
      </div>

      <div className="space-y-8">
        {[...grouped.entries()].map(([category, items]) => (
          <div key={category}>
            <div className="mb-2 flex items-baseline justify-between px-4">
              <span className="font-semibold text-[10px] text-text-muted uppercase tracking-widest">
                {category}
              </span>
              <span className="text-[10px] text-text-muted uppercase tracking-widest">
                Shortcut
              </span>
            </div>
            <div className="space-y-0.5">
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
            No keybindings registered yet. They appear once you open a canvas.
          </p>
        )}
      </div>
    </>
  );
}
