import { ArrowUpRight, Check, X } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { ToggleRow } from '@/pages/settings/components/toggle-row';
import { PRIVACY_POLICY_URL } from '@/pages/settings/sections/privacy-section';
import { getPlatform } from '@/platform';
import { StepHeader } from './step-header';

export function PrivacyStep() {
  const strings = useMessages();
  const analyticsEnabled = useUserPref('analyticsEnabled');

  return (
    <div>
      <StepHeader
        eyebrow={strings.onboarding.privacy.eyebrow}
        title={strings.onboarding.privacy.title}
        description={strings.onboarding.privacy.description}
      />

      <ToggleRow
        checked={analyticsEnabled}
        onToggle={() => UserPrefs.set('analyticsEnabled', !analyticsEnabled)}
        label={strings.settings.privacy.analytics.label}
        description={strings.settings.privacy.analytics.description}
      />

      <ul className="mt-4 space-y-2">
        <li className="flex items-start gap-2.5 text-text-muted text-xs leading-relaxed">
          <Check className="mt-0.5 size-3.5 shrink-0" />
          {strings.onboarding.privacy.collected}
        </li>
        <li className="flex items-start gap-2.5 text-text-muted text-xs leading-relaxed">
          <X className="mt-0.5 size-3.5 shrink-0" />
          {strings.onboarding.privacy.notCollected}
        </li>
      </ul>

      <button
        type="button"
        onClick={() => void getPlatform().openExternal(PRIVACY_POLICY_URL)}
        className="mt-5 flex cursor-pointer items-center gap-1 text-text-secondary text-xs underline underline-offset-4 transition-colors hover:text-text-primary"
      >
        {strings.onboarding.privacy.policy}
        <ArrowUpRight className="size-3.5" />
      </button>
    </div>
  );
}
