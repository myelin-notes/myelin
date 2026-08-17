import posthog from 'posthog-js';
import { MODE, POSTHOG_HOST, POSTHOG_KEY } from '@/lib/env';
import { UserPrefs } from '@/lib/user-prefs';

let initialized = false;

// Initialize PostHog for the desktop app. Autocapture, pageviews, and session
// recording stay off; we capture unhandled exceptions, the manual error reports
// forwarded from the logger, and explicit product events (see analytics.ts).
// All capture is gated behind the `analyticsEnabled` setting via PostHog's
// opt-in/opt-out, so turning analytics off stops error reporting too. No-ops
// when no project key is configured.
export function initErrorTracking(): void {
  applyAnalyticsConsent(UserPrefs.get('analyticsEnabled'));
  UserPrefs.subscribe('analyticsEnabled', applyAnalyticsConsent);
}

// `posthog.init` fetches remote config over the network, which is a request the
// user's IP rides on, so it is deferred until consent rather than run at boot.
// Granting consent later in Settings initializes it at that point.
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

// Mirror the analytics setting onto PostHog. Opting out disables every kind of
// capture — product events and automatic exception reporting alike — so the
// setting governs error tracking as well. `captureEventName: false` keeps the
// opt-in from emitting its own event.
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
