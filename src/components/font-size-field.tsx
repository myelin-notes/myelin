import { type PointerEvent, useState } from 'react';
import { Minus as MinusIcon, Plus as PlusIcon } from 'lucide-react';
import { useMessages } from '@/lib/i18n';

interface FontSizeFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /**
   * Keep focus where it is when a stepper is pressed. The canvas text controls
   * need this so the textarea being edited keeps its caret.
   */
  preserveFocus?: boolean;
}

// `grow` keeps the steppers at their 24px square wherever the field is sized to
// its content (the selection toolbar), and splits any extra width between them
// when it is stretched (the tool options column) so the value stays centered.
const STEPPER_CLASS =
  'flex size-6 shrink-0 grow cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary';

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
}: FontSizeFieldProps) {
  const strings = useMessages();
  // Null while the field isn't being typed into, so it mirrors the live value.
  // A string while typing, so a half-entered "1" isn't clamped up to the min
  // before the user gets to the "8".
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

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface p-0.5">
      <button
        type="button"
        aria-label={strings.canvas.toolOptions.decreaseFontSize}
        title={strings.canvas.toolOptions.decreaseFontSize}
        disabled={value <= min}
        onPointerDown={blockFocusShift}
        onClick={() => nudge(-step)}
        className={STEPPER_CLASS}
      >
        <MinusIcon className="size-3" strokeWidth={2.5} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={strings.canvas.toolOptions.fontSize}
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
        aria-label={strings.canvas.toolOptions.increaseFontSize}
        title={strings.canvas.toolOptions.increaseFontSize}
        disabled={value >= max}
        onPointerDown={blockFocusShift}
        onClick={() => nudge(step)}
        className={STEPPER_CLASS}
      >
        <PlusIcon className="size-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}
