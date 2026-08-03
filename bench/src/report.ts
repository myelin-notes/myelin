import type { SuiteRow } from './suite';

/** Must match `RESULT_ENDPOINT` in ../result-sink.ts. */
const RESULT_ENDPOINT = '/bench-result';

/**
 * Post a finished run back to the server that served this page.
 *
 * Uses `sendBeacon` so the report survives the page being backgrounded or
 * closed the moment the table appears — which is exactly what happens when
 * someone reads the number off a tablet and switches away. Falls back to
 * `fetch` with `keepalive` where the beacon is refused.
 *
 * Failures are swallowed: the on-screen table is the primary output, and a
 * bench opened against a plain static server should still work.
 */
export function postResult(payload: { text: string; rows: SuiteRow[] }): void {
  const body = JSON.stringify({
    ...payload,
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.(RESULT_ENDPOINT, blob)) {
      return;
    }
    void fetch(RESULT_ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* no sink listening — the on-screen table is still there */
  }
}
