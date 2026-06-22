import posthog from 'posthog-js';

const POSTHOG_KEY = (import.meta.env.PUBLIC_POSTHOG_KEY ?? '').trim();
const POSTHOG_HOST = (
  import.meta.env.PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
)
  .trim()
  .replace(/\/+$/, '');

let initialized = false;

// Initialize PostHog on the marketing site purely as an error tracker, mirroring
// the desktop app. Events are tagged `source: 'website'` so they can be told
// apart from the app. No-ops when no project key is configured.
export function initWebErrorTracking(): void {
  if (initialized || !POSTHOG_KEY) {
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    capture_exceptions: true,
  });
  posthog.register({
    environment: import.meta.env.MODE,
    source: 'website',
  });
  initialized = true;
}
