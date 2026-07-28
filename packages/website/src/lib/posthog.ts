type PostHog = typeof import('posthog-js').default;

const POSTHOG_KEY = (import.meta.env.PUBLIC_POSTHOG_KEY ?? '').trim();
const POSTHOG_HOST = (
  import.meta.env.PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'
)
  .trim()
  .replace(/\/+$/, '');

let client: PostHog | null = null;
let starting = false;

// Initialize PostHog on the marketing site. Unlike the desktop app — where
// product analytics are gated behind a setting — the website captures pageviews
// and events unconditionally. Events are tagged `source: 'website'` so they can
// be told apart from the app. No-ops when no project key is configured.
//
// `persistence: 'memory'` keeps the visitor's `distinct_id` in memory for the
// life of the page: no cookie, no localStorage, no sessionStorage. PostHog
// would otherwise write a 365-day first-party cookie, which is non-essential
// storage and needs consent in the EU/UK. The tradeoff is that every page load
// looks like a new person, so unique-visitor and retention numbers on the site
// are meaningless — pageview and event counts still are not.
//
// `posthog-js` is imported dynamically so it stays out of the layout's module
// graph: as a static import it was ~68K gzipped fetched alongside the canvas
// bundle, competing for bandwidth with the thing the visitor is waiting for.
export async function initWebAnalytics(): Promise<void> {
  if (starting || !POSTHOG_KEY) {
    return;
  }
  starting = true;

  const { default: posthog } = await import('posthog-js');
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    persistence: 'memory',
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
  client = posthog;
}

// Capture a custom product event. No-ops until analytics are initialized.
export function trackWebEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  client?.capture(event, properties);
}
