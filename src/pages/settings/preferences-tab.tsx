import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  localeLabels,
  type SupportedLocale,
  useI18n,
  useMessages,
} from '@/lib/i18n';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { KeybindsSection } from './keybinds-tab';
import { RepositorySection } from './repository-section';

type CanvasBg = 'grid' | 'dots' | 'blank';

const MODIFIER_KEY_LABEL =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

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
  const strings = useMessages();
  const { setLocale } = useI18n();
  const [canvasBg, setCanvasBg] = useState<CanvasBg>(
    UserPrefs.get('canvasBackground'),
  );
  const [language, setLanguage] = useState(UserPrefs.get('language'));
  const [pageFrameEditFitWholePage, setPageFrameEditFitWholePage] = useState(
    UserPrefs.get('pageFrameEditFitWholePage'),
  );
  const [noteLinkHoverPreview, setNoteLinkHoverPreview] = useState(
    UserPrefs.get('noteLinkHoverPreview'),
  );
  const [linkRequireModifier, setLinkRequireModifier] = useState(
    UserPrefs.get('linkRequireModifier'),
  );
  const languages = Object.entries(localeLabels).map(([code, label]) => ({
    code: code as SupportedLocale,
    label,
  }));

  useEffect(() => {
    return UserPrefs.subscribe('canvasBackground', setCanvasBg);
  }, []);

  useEffect(() => {
    return UserPrefs.subscribe('language', setLanguage);
  }, []);

  useEffect(() => {
    return UserPrefs.subscribe(
      'pageFrameEditFitWholePage',
      setPageFrameEditFitWholePage,
    );
  }, []);

  useEffect(() => {
    return UserPrefs.subscribe(
      'noteLinkHoverPreview',
      setNoteLinkHoverPreview,
    );
  }, []);

  useEffect(() => {
    return UserPrefs.subscribe(
      'linkRequireModifier',
      setLinkRequireModifier,
    );
  }, []);

  const handleCanvasBg = (bg: CanvasBg) => {
    UserPrefs.set('canvasBackground', bg);
  };

  const handlePageFrameEditFitWholePage = () => {
    UserPrefs.set('pageFrameEditFitWholePage', !pageFrameEditFitWholePage);
  };

  const handleNoteLinkHoverPreview = () => {
    UserPrefs.set('noteLinkHoverPreview', !noteLinkHoverPreview);
  };

  const handleLinkRequireModifier = () => {
    UserPrefs.set('linkRequireModifier', !linkRequireModifier);
  };

  const handleLanguage = (code: string) => {
    setLocale(code as SupportedLocale);
  };

  const selectedLang =
    languages.find((item) => item.code === language) ?? languages[0];

  return (
    <div className="max-w-3xl">
      <header className="mb-10 md:mb-14">
        <h1
          className="font-extralight font-heading text-text-primary tracking-tight"
          style={{ fontSize: 'var(--fluid-display)' }}
        >
          {strings.settings.title}
        </h1>
        <p className="mt-3 text-text-muted leading-relaxed">
          {strings.settings.description}
        </p>
      </header>

      <div className="space-y-12 md:space-y-16">
        {/* Canvas Background */}
        <section>
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
        </section>

        {/* Language */}
        <section>
          <div className="mb-6 flex items-baseline justify-between">
            <h3 className="font-heading text-xl">
              {strings.settings.language.title}
            </h3>
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              {strings.settings.language.eyebrow}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="group flex w-full max-w-xs cursor-pointer items-center justify-between rounded-xl bg-input px-4 py-3 text-sm transition-colors hover:bg-hover-tint">
              <div className="flex items-center gap-3">
                <span className="font-medium text-[10px] text-text-muted uppercase tracking-widest">
                  {selectedLang.code.split('-')[0]}
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
                {languages.map((lang) => (
                  <DropdownMenuRadioItem key={lang.code} value={lang.code}>
                    <span className="w-7 font-medium text-[10px] text-text-muted uppercase tracking-widest">
                      {lang.code.split('-')[0]}
                    </span>
                    <span>{lang.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <section>
          <div className="mb-6 flex items-baseline justify-between">
            <h3 className="font-heading text-xl">
              {strings.settings.pageFrameEditing.title}
            </h3>
            <span className="text-[10px] text-text-muted uppercase tracking-widest">
              {strings.settings.pageFrameEditing.eyebrow}
            </span>
          </div>
          <div className="space-y-2">
            <ToggleRow
              checked={pageFrameEditFitWholePage}
              onToggle={handlePageFrameEditFitWholePage}
              label={strings.settings.pageFrameEditing.fitWholePage.label}
              description={
                strings.settings.pageFrameEditing.fitWholePage.description
              }
            />
            <ToggleRow
              checked={noteLinkHoverPreview}
              onToggle={handleNoteLinkHoverPreview}
              label={strings.settings.pageFrameEditing.hoverPreview.label}
              description={
                strings.settings.pageFrameEditing.hoverPreview.description
              }
            />
            <ToggleRow
              checked={linkRequireModifier}
              onToggle={handleLinkRequireModifier}
              label={strings.settings.pageFrameEditing.requireModifier.label(
                MODIFIER_KEY_LABEL,
              )}
              description={strings.settings.pageFrameEditing.requireModifier.description(
                MODIFIER_KEY_LABEL,
              )}
            />
          </div>
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

function ToggleRow({
  checked,
  onToggle,
  label,
  description,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 text-left transition-colors hover:bg-hover-tint"
    >
      <span className="min-w-0">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span
        className={cn(
          'relative flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-accent-dark' : 'bg-text-muted/20',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}
