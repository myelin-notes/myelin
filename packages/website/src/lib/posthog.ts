import posthog from 'posthog-js';

const POSTHOG_KEY = (import.meta.env.PUBLIC_POSTHOG_KEY ?? '').trim();
const POSTHOG_HOST = (
  import.meta.env.PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
)
  .trim()
  .replace(/\/+$/, '');

let initialized = false;

// Initialize PostHog on the marketing site. Unlike the desktop app — where
// product analytics are gated behind a setting — the website captures pageviews
// and events unconditionally. Events are tagged `source: 'website'` so they can
// be told apart from the app. No-ops when no project key is configured.
export function initWebAnalytics(): void {
  if (initialized || !POSTHOG_KEY) {
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
    disable_session_recording: true,
    capture_exceptions: true,
  });
  posthog.register({
    environment: import.meta.env.MODE,
    source: 'website',
  });
  initialized = true;
}

// Capture a custom product event. No-ops until analytics are initialized.
export function trackWebEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) {
    return;
  }
  posthog.capture(event, properties);
}
