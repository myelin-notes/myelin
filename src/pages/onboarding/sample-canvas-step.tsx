import { useMessages } from '@/lib/i18n';
import { StepHeader } from './step-header';

export function SampleCanvasStep() {
  const strings = useMessages();
  const copy = strings.onboarding.sample;

  return (
    <div>
      <StepHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <ul className="divide-y divide-border-divider/60 overflow-hidden rounded-xl bg-input/40 ring-1 ring-border-subtle/70">
        {(['frame', 'canvas', 'syntax', 'checklist'] as const).map(
          (highlight) => (
            <li
              key={highlight}
              className="px-4 py-3 font-medium text-sm text-text-primary"
            >
              {copy.highlights[highlight]}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
