import { UserPrefs } from '@myelin/editor/user-prefs';
import { isErrorTrackingEnabled, posthog } from '@/lib/posthog';

// Product event tracking. Events are only captured while the user keeps
// `analyticsEnabled` on in Settings. No-ops when PostHog is not configured or
// analytics are disabled.
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!isErrorTrackingEnabled() || !UserPrefs.get('analyticsEnabled')) {
    return;
  }
  posthog.capture(event, properties);
}
