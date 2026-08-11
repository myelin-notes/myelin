import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OptionsRowOption<T extends string> = {
  value: T;
  label: string;
  Icon?: LucideIcon;
  /** CSS color shown as a leading chip in place of `Icon`. */
  swatch?: string;
};

export function OptionsRow<T extends string>({
  value,
  onChange,
  label,
  description,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  label: string;
  description: string;
  options: ReadonlyArray<OptionsRowOption<T>>;
}) {
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl bg-input/40 px-4 py-3 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span
        className="grid w-full shrink-0 gap-1 rounded-lg bg-card/70 p-1 ring-1 ring-border-ghost sm:w-auto"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(max-content, 1fr))`,
        }}
      >
        {options.map(
          ({ value: optionValue, label: optionLabel, Icon, swatch }) => {
            const selected = value === optionValue;
            return (
              <button
                key={optionValue}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(optionValue)}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 font-medium text-xs transition-colors',
                  selected
                    ? 'bg-accent-dark text-text-on-dark shadow-sm'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {swatch ? (
                  <span
                    className="size-3.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: swatch,
                      // currentColor so the ring stays visible against both the
                      // dark selected pill and the light track.
                      boxShadow:
                        '0 0 0 1px color-mix(in srgb, currentColor 35%, transparent)',
                    }}
                  />
                ) : (
                  Icon && <Icon className="size-3.5" />
                )}
                <span>{optionLabel}</span>
              </button>
            );
          },
        )}
      </span>
    </div>
  );
}
