import { type ComponentType, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { ColorPickerDialog } from '@myelin/editor/components/color-picker-dialog';
import { useMessages } from '@myelin/editor/i18n';
import type { UserPrefValue } from '@myelin/editor/user-prefs';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { cn } from '@myelin/editor/utils';
import { useUserPref } from '@/lib/use-user-pref';
import { OptionsRow, type OptionsRowOption } from '../components/options-row';

type CanvasBg = 'grid' | 'dots' | 'blank';
type ThemeMode = UserPrefValue<'theme'>;
type BgColorMode = UserPrefValue<'canvasBackgroundColorMode'>;

const THEME_OPTIONS: {
  value: ThemeMode;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

function CanvasPreview({
  type,
  selected,
  onSelect,
}: {
  type: CanvasBg;
  selected: boolean;
  onSelect: () => void;
}) {
  const strings = useMessages();
  const labels: Record<CanvasBg, string> = strings.settings.canvasStyle.options;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          'relative aspect-video overflow-hidden rounded-xl p-4 transition-all duration-200',
          selected
            ? 'bg-card shadow-ambient ring-2 ring-accent-navy/20'
            : 'bg-input ring-1 ring-border-subtle/70 hover:bg-card-active hover:shadow-ambient hover:ring-text-muted/40',
        )}
      >
        {selected && (
          <div className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full bg-accent-navy">
            <Check className="size-2.5 text-text-on-dark" />
          </div>
        )}
        <div className="h-full w-full">
          {type === 'grid' && (
            <div
              className="h-full w-full opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(var(--text-primary) 1px, transparent 1px), linear-gradient(90deg, var(--text-primary) 1px, transparent 1px)',
                backgroundSize: '12px 12px',
              }}
            />
          )}
          {type === 'dots' && (
            <div
              className="h-full w-full opacity-30"
              style={{
                backgroundImage:
                  'radial-gradient(var(--text-primary) 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            />
          )}
          {type === 'blank' && <div className="h-full w-full" />}
        </div>
      </div>
      <span
        className={cn(
          'mt-3 block text-center text-[10px] uppercase tracking-widest transition-colors',
          selected
            ? 'font-semibold text-text-brand'
            : 'text-text-muted group-hover:text-text-primary',
        )}
      >
        {labels[type]}
      </span>
    </button>
  );
}

export function AppearanceSection() {
  const strings = useMessages();
  const theme = useUserPref('theme');
  const canvasBg = useUserPref('canvasBackground');
  const bgColorMode = useUserPref('canvasBackgroundColorMode');
  const bgColor = useUserPref('canvasBackgroundColor');
  const [pickerOpen, setPickerOpen] = useState(false);
  const handleCanvasBg = (bg: CanvasBg) => {
    UserPrefs.set('canvasBackground', bg);
  };
  const handleBgColorMode = (mode: BgColorMode) => {
    UserPrefs.set('canvasBackgroundColorMode', mode);
    setPickerOpen(mode === 'custom');
  };
  const themeLabels = strings.settings.theme.options;
  const bgColorStrings = strings.settings.canvasStyle.backgroundColor;
  const bgColorRowOptions: ReadonlyArray<OptionsRowOption<BgColorMode>> = [
    // A CSS var, not a resolved value, so the chip re-resolves on theme toggle.
    {
      value: 'theme',
      label: bgColorStrings.options.theme,
      swatch: 'var(--bg-page)',
    },
    { value: 'custom', label: bgColorStrings.options.custom, swatch: bgColor },
  ];

  return (
    <section id="appearance" className="scroll-mt-12 space-y-10">
      <div>
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h3 className="font-heading text-xl">
            {strings.settings.theme.title}
          </h3>
          <span className="text-[10px] text-text-muted uppercase tracking-widest">
            {strings.settings.theme.eyebrow}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ value, icon: Icon }) => {
            const selected = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => UserPrefs.set('theme', value)}
                aria-pressed={selected}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all duration-200',
                  selected
                    ? 'bg-card shadow-ambient ring-2 ring-accent-navy/20'
                    : 'bg-input ring-1 ring-border-subtle/70 hover:bg-card-active hover:shadow-ambient',
                )}
              >
                <Icon
                  className={cn(
                    'size-4 transition-colors',
                    selected ? 'text-text-brand' : 'text-text-muted',
                  )}
                />
                <span
                  className={cn(
                    'text-xs transition-colors',
                    selected
                      ? 'font-semibold text-text-brand'
                      : 'text-text-muted',
                  )}
                >
                  {themeLabels[value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h3 className="font-heading text-xl">
            {strings.settings.canvasStyle.title}
          </h3>
          <span className="text-[10px] text-text-muted uppercase tracking-widest">
            {strings.settings.canvasStyle.eyebrow}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
          {(['grid', 'dots', 'blank'] as const).map((type) => (
            <CanvasPreview
              key={type}
              type={type}
              selected={canvasBg === type}
              onSelect={() => handleCanvasBg(type)}
            />
          ))}
        </div>

        <div className="mt-5">
          <OptionsRow
            value={bgColorMode}
            onChange={handleBgColorMode}
            label={bgColorStrings.label}
            description={bgColorStrings.description}
            options={bgColorRowOptions}
          />
        </div>
      </div>

      <ColorPickerDialog
        open={pickerOpen}
        initialColor={bgColor}
        title={bgColorStrings.label}
        confirmLabel={bgColorStrings.confirm}
        onConfirm={(hex) => {
          UserPrefs.set('canvasBackgroundColor', hex);
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </section>
  );
}
