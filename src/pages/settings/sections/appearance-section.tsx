import type { ComponentType } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { setCanvasStyle } from '@myelin/editor/canvas-style';
import { useMessages } from '@myelin/editor/i18n';
import type { UserPrefValue } from '@myelin/editor/user-prefs';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { cn } from '@myelin/editor/utils';
import { useCanvasStyle } from '@/lib/use-canvas-style';
import { useUserPref } from '@/lib/use-user-pref';
import { CanvasStyleEditor } from '../components/canvas-style-editor';

type ThemeMode = UserPrefValue<'theme'>;

const THEME_OPTIONS: {
  value: ThemeMode;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export function AppearanceSection() {
  const strings = useMessages();
  const theme = useUserPref('theme');
  const { style: canvasStyle } = useCanvasStyle(null);
  const themeLabels = strings.settings.theme.options;

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
        <CanvasStyleEditor
          style={canvasStyle}
          onChange={(patch) => setCanvasStyle(null, patch)}
        />
      </div>
    </section>
  );
}
