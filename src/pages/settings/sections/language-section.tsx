import { ChevronDown } from 'lucide-react';
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
import { useUserPref } from '@/lib/use-user-pref';

export function LanguageSection() {
  const strings = useMessages();
  const { setLocale } = useI18n();
  const language = useUserPref('language');
  const languages = Object.entries(localeLabels).map(([code, label]) => ({
    code: code as SupportedLocale,
    label,
  }));

  const handleLanguage = (code: string) => {
    setLocale(code as SupportedLocale);
  };

  const selectedLang =
    languages.find((item) => item.code === language) ?? languages[0];

  return (
    <section id="language" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">
          {strings.settings.language.title}
        </h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.language.eyebrow}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger className="group flex w-full max-w-xs cursor-pointer items-center justify-between rounded-xl bg-input px-4 py-3 text-sm ring-1 ring-border-subtle/70 transition-colors hover:bg-hover-tint">
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
  );
}
