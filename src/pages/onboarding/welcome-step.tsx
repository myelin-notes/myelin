import { useMessages } from '@myelin/editor/i18n';
import { LanguagePicker } from '@/components/language-picker';
import { StepHeader } from './step-header';

export function WelcomeStep() {
  const strings = useMessages();

  return (
    <div>
      <StepHeader
        eyebrow={strings.onboarding.welcome.eyebrow}
        title={strings.onboarding.welcome.title}
        description={strings.onboarding.welcome.description}
      />
      <p className="mb-2 text-[10px] text-text-muted uppercase tracking-widest">
        {strings.onboarding.welcome.language}
      </p>
      <LanguagePicker />
    </div>
  );
}
