import { ArrowUpRight } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { getPlatform } from '@myelin/editor/platform';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { useUserPref } from '@/lib/use-user-pref';
import { ToggleRow } from '../components/toggle-row';

/**
 * The published policy describing what the analytics toggle sends. App Store
 * guideline 5.1.1(i) requires it to be reachable from inside the app, not just
 * from the store listing, which is what the row below the toggle is for.
 */
export const PRIVACY_POLICY_URL = 'https://trymyelin.app/privacy';

export function PrivacySection() {
  const strings = useMessages();
  const analyticsEnabled = useUserPref('analyticsEnabled');

  const handleAnalytics = () => {
    UserPrefs.set('analyticsEnabled', !analyticsEnabled);
  };

  const handlePolicy = () => {
    void getPlatform().openExternal(PRIVACY_POLICY_URL);
  };

  return (
    <section id="privacy" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl">
          {strings.settings.privacy.title}
        </h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.privacy.eyebrow}
        </span>
      </div>
      <div className="space-y-2">
        <ToggleRow
          checked={analyticsEnabled}
          onToggle={handleAnalytics}
          label={strings.settings.privacy.analytics.label}
          description={strings.settings.privacy.analytics.description}
        />
        <button
          type="button"
          onClick={handlePolicy}
          className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl bg-input/40 px-4 py-3 text-left ring-1 ring-border-subtle/70 transition-colors hover:bg-input"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm text-text-primary">
              {strings.settings.privacy.policy.label}
            </span>
            <span className="mt-1 block text-text-muted text-xs leading-relaxed">
              {strings.settings.privacy.policy.description}
            </span>
          </span>
          <ArrowUpRight className="size-4 shrink-0 text-text-muted" />
        </button>
      </div>
    </section>
  );
}
