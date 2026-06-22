import posthog from 'posthog-js';
import { MODE, POSTHOG_HOST, POSTHOG_KEY } from '@/lib/env';

let initialized = false;

// Initialize PostHog purely as an error tracker. Product analytics features
// (autocapture, pageviews, session recording) are disabled; we only want
// unhandled-exception autocapture plus the manual reports forwarded from the
// logger. No-ops when no project key is configured.
export function initErrorTracking(): void {
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
  posthog.register({ environment: MODE, source: 'desktop-app' });
  initialized = true;
}

export function isErrorTrackingEnabled(): boolean {
  return initialized;
}

export { posthog };
