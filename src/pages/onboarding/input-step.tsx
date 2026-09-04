import { useMessages } from '@myelin/editor/i18n';
import { InputModeRow } from '@/pages/settings/sections/input-section';
import { StepHeader } from './step-header';

export function InputStep() {
  const strings = useMessages();

  return (
    <div>
      <StepHeader
        eyebrow={strings.onboarding.input.eyebrow}
        title={strings.onboarding.input.title}
        description={strings.onboarding.input.description}
      />
      <InputModeRow />
    </div>
  );
}
