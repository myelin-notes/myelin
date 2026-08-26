import posthog from 'posthog-js';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { MODE, POSTHOG_HOST, POSTHOG_KEY } from '@/lib/env';

let initialized = false;

// Autocapture, pageviews and session recording stay off; only unhandled exceptions, logger-
// forwarded error reports, and explicit product events (see analytics.ts) are captured. All capture
// is gated behind the `analyticsEnabled` setting, so turning analytics off stops error reporting too.
export function initErrorTracking(): void {
  applyAnalyticsConsent(UserPrefs.get('analyticsEnabled'));
  UserPrefs.subscribe('analyticsEnabled', applyAnalyticsConsent);
}

// `posthog.init` fetches remote config over the network, a request the user's IP rides on, so it
// is deferred until consent rather than run at boot.
function ensureInitialized(): boolean {
  if (initialized) {
    return true;
  }
  if (!POSTHOG_KEY) {
    return false;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    capture_exceptions: true,
    opt_out_capturing_by_default: true,
  });
  posthog.register({ environment: MODE, source: 'app' });
  initialized = true;
  return true;
}

// Opting out disables every kind of capture — product events and automatic exception reporting
// alike. `captureEventName: false` keeps the opt-in from emitting its own event.
function applyAnalyticsConsent(enabled: boolean): void {
  if (!enabled) {
    if (initialized) {
      posthog.opt_out_capturing();
    }
    return;
  }
  if (ensureInitialized()) {
    posthog.opt_in_capturing({ captureEventName: false });
  }
}

export function isErrorTrackingEnabled(): boolean {
  return initialized;
}

export { posthog };
