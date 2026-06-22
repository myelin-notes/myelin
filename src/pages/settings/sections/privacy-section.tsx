import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { ToggleRow } from '../components/toggle-row';

export function PrivacySection() {
  const strings = useMessages();
  const analyticsEnabled = useUserPref('analyticsEnabled');

  const handleAnalytics = () => {
    UserPrefs.set('analyticsEnabled', !analyticsEnabled);
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
      </div>
    </section>
  );
}
