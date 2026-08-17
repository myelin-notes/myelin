import { LanguagePicker } from '@/components/language-picker';
import { useMessages } from '@/lib/i18n';

export function LanguageSection() {
  const strings = useMessages();

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
      <LanguagePicker collisionPadding={{ bottom: -200 }} />
    </section>
  );
}
