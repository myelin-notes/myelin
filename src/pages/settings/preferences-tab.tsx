import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { KeybindsSection } from './keybinds-tab';
import { RepositorySection } from './repository-section';

type CanvasBg = 'grid' | 'dots' | 'blank';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espa\u00f1ol' },
  { code: 'fr', label: 'Fran\u00e7ais' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '\u65e5\u672c\u8a9e' },
  { code: 'zh', label: '\u4e2d\u6587' },
  { code: 'ko', label: '\ud55c\uad6d\uc5b4' },
  { code: 'pt', label: 'Portugu\u00eas' },
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
  const labels: Record<CanvasBg, string> = {
    grid: 'Grid',
    dots: 'Dots',
    blank: 'Blank',
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group cursor-pointer text-left"
    >
      <div
        className={cn(
          'relative aspect-video overflow-hidden rounded-xl p-4 transition-all duration-200',
          selected
            ? 'bg-white shadow-ambient ring-2 ring-accent-navy/20'
            : 'bg-input hover:bg-white hover:shadow-ambient',
        )}
      >
        {selected && (
          <div className="absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full bg-accent-navy">
            <Check className="size-2.5 text-white" />
          </div>
        )}
        <div className="h-full w-full">
          {type === 'grid' && (
            <div
              className="h-full w-full opacity-20"
              style={{
                backgroundImage:
                  'linear-gradient(var(--accent-dark) 1px, transparent 1px), linear-gradient(90deg, var(--accent-dark) 1px, transparent 1px)',
                backgroundSize: '12px 12px',
              }}
            />
          )}
          {type === 'dots' && (
            <div
              className="h-full w-full opacity-30"
              style={{
                backgroundImage:
                  'radial-gradient(var(--accent-dark) 1px, transparent 1px)',
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
            ? 'font-semibold text-accent-navy'
            : 'text-text-muted group-hover:text-text-primary',
        )}
      >
        {labels[type]}
      </span>
    </button>
  );
}

export function PreferencesTab() {
  const [canvasBg, setCanvasBg] = useState<CanvasBg>(
    UserPrefs.get('canvasBackground'),
  );
  const [language, setLanguage] = useState(UserPrefs.get('language'));

  useEffect(() => {
    return UserPrefs.subscribe('canvasBackground', setCanvasBg);
  }, []);

  useEffect(() => {
    return UserPrefs.subscribe('language', setLanguage);
  }, []);

  const handleCanvasBg = (bg: CanvasBg) => {
    UserPrefs.set('canvasBackground', bg);
  };

  const handleLanguage = (code: string) => {
    UserPrefs.set('language', code);
  };

  const selectedLang =
    LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];

  return (
    <div className="max-w-3xl">
      <header className="mb-14">
        <h1 className="font-extralight font-heading text-[2.75rem] text-text-primary tracking-tight">
          Preferences
        </h1>
        <p className="mt-3 text-text-muted leading-relaxed">
          Customize your creative sanctuary. These settings adjust the visual
          atmosphere and functional depth of your infinite canvas.
        </p>
      </header>

      <div className="space-y-16">
        {/* Canvas Background */}
        <section>
          <div className="mb-6 flex items-baseline justify-between">
            <h3 className="font-heading text-xl">Canvas Style</h3>
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              Surface Layer
            </span>
          </div>
          <div className="grid grid-cols-3 gap-5">
            {(['grid', 'dots', 'blank'] as const).map((type) => (
              <CanvasPreview
                key={type}
                type={type}
                selected={canvasBg === type}
                onSelect={() => handleCanvasBg(type)}
              />
            ))}
          </div>
        </section>

        {/* Language */}
        <section>
          <div className="mb-6 flex items-baseline justify-between">
            <h3 className="font-heading text-xl">Language</h3>
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              Interface
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="group flex w-full max-w-xs cursor-pointer items-center justify-between rounded-xl bg-input px-4 py-3 text-sm transition-colors hover:bg-hover-tint">
              <div className="flex items-center gap-3">
                <span className="font-medium text-[10px] text-text-muted uppercase tracking-widest">
                  {selectedLang.code}
                </span>
                <span className="text-text-primary">{selectedLang.label}</span>
              </div>
              <ChevronDown className="size-4 text-text-muted transition-transform duration-200 group-data-popup-open:rotate-180" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-72"
              collisionPadding={{ bottom: -200 }}
            >
              <DropdownMenuRadioGroup
                value={language}
                onValueChange={handleLanguage}
              >
                {LANGUAGES.map((lang) => (
                  <DropdownMenuRadioItem key={lang.code} value={lang.code}>
                    <span className="w-7 font-medium text-[10px] text-text-muted uppercase tracking-widest">
                      {lang.code}
                    </span>
                    <span>{lang.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        {/* Repository */}
        <section>
          <RepositorySection />
        </section>

        {/* Keybinds */}
        <section>
          <KeybindsSection />
        </section>
      </div>
    </div>
  );
}
