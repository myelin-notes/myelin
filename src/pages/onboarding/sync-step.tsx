import { useMessages } from '@/lib/i18n';
import { RepositorySetup } from '@/pages/settings/repository-section/setup';
import { StepHeader } from './step-header';

export function SyncStep() {
  const strings = useMessages();

  return (
    <div>
      <StepHeader
        eyebrow={strings.onboarding.sync.eyebrow}
        title={strings.onboarding.sync.title}
        description={strings.onboarding.sync.description}
      />
      <RepositorySetup />
      <p className="mt-4 text-text-muted text-xs">
        {strings.onboarding.sync.later}
      </p>
    </div>
  );
}
