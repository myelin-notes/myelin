import { type PointerEvent, useState } from 'react';
import { Minus as MinusIcon, Plus as PlusIcon } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';

interface FontSizeFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** The canvas text controls need this so the textarea being edited keeps its caret. */
  preserveFocus?: boolean;
  ariaLabel?: string;
  touchTargets?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function FontSizeField({
  value,
  min,
  max,
  step,
  onChange,
  preserveFocus,
  ariaLabel,
  touchTargets = false,
}: FontSizeFieldProps) {
  const strings = useMessages();
  // Null while the field isn't being typed into, so it mirrors the live value. A string while typing,
  // so a half-entered "1" isn't clamped up to the min before the user gets to the "8".
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    setDraft(null);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed, min, max));
    }
  };

  const nudge = (delta: number) => {
    setDraft(null);
    onChange(clamp(value + delta, min, max));
  };

  const blockFocusShift = preserveFocus
    ? (event: PointerEvent<HTMLButtonElement>) => event.preventDefault()
    : undefined;

  const stepperClass = `flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary ${touchTargets ? 'pointer-coarse:size-9' : ''}`;

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface p-0.5">
      <button
        type="button"
        aria-label={
          ariaLabel
            ? `${ariaLabel}: ${strings.canvas.toolOptions.decreaseFontSize}`
            : strings.canvas.toolOptions.decreaseFontSize
        }
        title={strings.canvas.toolOptions.decreaseFontSize}
        disabled={value <= min}
        onPointerDown={blockFocusShift}
        onClick={() => nudge(-step)}
        className={stepperClass}
      >
        <MinusIcon className="size-3" strokeWidth={2.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel ?? strings.canvas.toolOptions.fontSize}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className="w-7 shrink-0 border-none bg-transparent text-center font-medium text-text-primary text-xs tabular-nums outline-none"
      />
      <button
        type="button"
        aria-label={
          ariaLabel
            ? `${ariaLabel}: ${strings.canvas.toolOptions.increaseFontSize}`
            : strings.canvas.toolOptions.increaseFontSize
        }
        title={strings.canvas.toolOptions.increaseFontSize}
        disabled={value >= max}
        onPointerDown={blockFocusShift}
        onClick={() => nudge(step)}
        className={stepperClass}
      >
        <PlusIcon className="size-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
