import { useCallback, useState } from 'react';
import { WindowControls } from '@/components/layout/window-controls';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  isMac,
  isWindows,
  TAB_BAR_HEIGHT_CLASS,
  TRAFFIC_LIGHT_INSET_CLASS,
} from '@/lib/platform';
import { useRepository } from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { PrivacyStep } from './privacy-step';
import { createStarterCanvasFile } from './starter-canvas';
import { SyncStep } from './sync-step';
import { TourStep } from './tour-step';
import { WelcomeStep } from './welcome-step';

const logger = new Logger('Onboarding');

const STEPS = ['welcome', 'privacy', 'sync', 'tour'] as const;

/**
 * First-run setup, shown in place of the app shell until
 * `onboardingCompleted` is set. It owns the two decisions that cannot be made
 * for the user — analytics consent and where their notes live — and hands off
 * to the coachmark tour on the way out.
 *
 * The analytics toggle writes straight through to the preference rather than
 * being staged until the end: turning it on is the consent, and quitting
 * halfway must not leave a decision half-applied.
 */
export function OnboardingFlow({
  onDone,
}: {
  onDone: (options: { startTour: boolean }) => void;
}) {
  const strings = useMessages();
  const repository = useRepository();
  const tabController = useTabController();
  const [index, setIndex] = useState(0);
  const [syncComplete, setSyncComplete] = useState(false);
  const step = STEPS[index];
  // A half-connected remote would leave the app unable to sync, so
  // the step holds Continue until the choice is actually usable.
  const blocked = step === 'sync' && !syncComplete;

  const finish = useCallback(
    async (requestedTour: boolean) => {
      let startTour = requestedTour;

      if (startTour) {
        try {
          const name = await repository.getUniqueFileName(
            strings.onboarding.tour.canvasName,
            null,
          );
          const id = await createStarterCanvasFile(repository, name, strings);
          tabController.openTab({ type: 'canvas', id }, name);
        } catch (error) {
          // The tour walks the canvas toolbar, so without a canvas there is
          // nothing to point at — finish into the empty app shell instead.
          logger.error('Failed to create the tour canvas', error);
          startTour = false;
        }
      }

      UserPrefs.set('onboardingCompleted', true);
      trackEvent('onboarding_completed', { tour_started: startTour });
      onDone({ startTour });
    },
    [onDone, repository, strings, tabController],
  );

  return (
    <div className="flex h-full w-full flex-col bg-page">
      <header
        data-tauri-drag-region
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 pr-2 pl-4',
          TAB_BAR_HEIGHT_CLASS,
          isMac && TRAFFIC_LIGHT_INSET_CLASS,
        )}
      >
        <button
          type="button"
          onClick={() => void finish(false)}
          className="cursor-pointer text-text-muted text-xs transition-colors hover:text-text-primary"
        >
          {strings.onboarding.skip}
        </button>
        {isWindows && <WindowControls />}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-8">
        <div className="flex min-h-full items-center justify-center py-8">
          <div className="fade-in-0 slide-in-from-bottom-2 w-full max-w-xl animate-in duration-[150ms] ease-out">
            {step === 'welcome' && <WelcomeStep />}
            {step === 'privacy' && <PrivacyStep />}
            {step === 'sync' && (
              <SyncStep
                complete={syncComplete}
                onCompleteChange={setSyncComplete}
              />
            )}
            {step === 'tour' && <TourStep />}
          </div>
        </div>
      </main>

      <footer className="shrink-0 border-border-subtle border-t px-6 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-4">
          <span className="text-[10px] text-text-muted uppercase tracking-widest">
            {strings.onboarding.stepLabel(index + 1, STEPS.length)}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                variant="ghost"
                onClick={() => setIndex((current) => current - 1)}
                className="text-text-muted"
              >
                {strings.onboarding.back}
              </Button>
            )}
            {step === 'tour' ? (
              <>
                <Button variant="ghost" onClick={() => void finish(false)}>
                  {strings.onboarding.tour.skip}
                </Button>
                <Button onClick={() => void finish(true)}>
                  {strings.onboarding.tour.start}
                </Button>
              </>
            ) : (
              <Button
                disabled={blocked}
                onClick={() => setIndex((current) => current + 1)}
              >
                {step === 'welcome'
                  ? strings.onboarding.welcome.start
                  : strings.onboarding.continue}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
