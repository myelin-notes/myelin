import { TOUR_STEPS } from '@/components/tour/steps';
import { useMessages } from '@/lib/i18n';
import { StepHeader } from './step-header';

export function TourStep() {
  const strings = useMessages();

  return (
    <div>
      <StepHeader
        eyebrow={strings.onboarding.tour.eyebrow}
        title={strings.onboarding.tour.title}
        description={strings.onboarding.tour.description}
      />
      <ol className="divide-y divide-border-divider/60 overflow-hidden rounded-xl bg-input/40 ring-1 ring-border-subtle/70">
        {TOUR_STEPS.map((step, index) => (
          <li key={step.id} className="flex items-center gap-3 px-4 py-3">
            <span className="w-4 shrink-0 text-[10px] text-text-muted tabular-nums">
              {index + 1}
            </span>
            <span className="font-medium text-sm text-text-primary">
              {strings.tour.steps[step.id].title}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
