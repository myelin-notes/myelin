import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownToLine, MapPin, Search } from 'lucide-react';

export interface PaletteCommand {
  id: string;
  group: 'Go to' | 'Get it';
  label: string;
  run: () => void;
}

const GROUP_ICON: Record<PaletteCommand['group'], LucideIcon> = {
  'Go to': MapPin,
  'Get it': ArrowDownToLine,
};

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

/** Cmd/Ctrl+P quick navigation, in the app's command palette idiom. */
export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = commands.filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );
  const clampedSelected = Math.min(selected, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const runCommand = (command: PaletteCommand) => {
    onClose();
    command.run();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected(Math.min(clampedSelected + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected(Math.max(clampedSelected - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[clampedSelected];
      if (command) {
        runCommand(command);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let lastGroup: string | null = null;

  return (
    // `data-canvas-ui` keeps the fake scroll off the results list, which
    // scrolls natively.
    <div
      data-canvas-ui
      className="fixed inset-0 z-[120] bg-black/20"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="mx-auto mt-28 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-xl bg-card shadow-elevated ring-1 ring-border-subtle"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-border-divider border-b px-4 py-3">
          <Search className="size-4 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="Jump anywhere in the notebook"
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          <kbd className="rounded bg-key px-1.5 py-0.5 text-[10px] text-text-muted ring-1 ring-border-key">
            esc
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-text-muted">
              Nothing matches. Try a scene name or "download".
            </li>
          )}
          {filtered.map((command, index) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            const Icon = GROUP_ICON[command.group];
            return (
              <li key={command.id}>
                {showGroup && (
                  <p className="px-3 pt-2 pb-1 font-medium text-[11px] text-text-muted uppercase tracking-wide">
                    {command.group}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => runCommand(command)}
                  onPointerMove={() => setSelected(index)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                    index === clampedSelected
                      ? 'bg-hover-tint text-text-primary'
                      : 'text-text-secondary'
                  }`}
                >
                  <Icon className="size-4 text-text-muted" />
                  {command.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
