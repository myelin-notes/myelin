import { useMessages } from '@myelin/editor/i18n';
import { RepositorySetup } from '@/pages/settings/repository-section/setup';
import { StepHeader } from './step-header';

export function SyncStep({
  complete,
  onCompleteChange,
}: {
  complete: boolean;
  onCompleteChange: (complete: boolean) => void;
}) {
  const strings = useMessages();

  return (
    <div>
      <StepHeader
        eyebrow={strings.onboarding.sync.eyebrow}
        title={strings.onboarding.sync.title}
        description={strings.onboarding.sync.description}
      />
      <RepositorySetup onSetupCompleteChange={onCompleteChange} />
      <p className="mt-4 text-text-muted text-xs">
        {complete
          ? strings.onboarding.sync.later
          : strings.onboarding.sync.incomplete}
      </p>
    </div>
  );
}
