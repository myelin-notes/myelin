/**
 * Product event tracking seam. The editor package has no analytics backend of
 * its own; the host installs a sink at bootstrap (the desktop app forwards to
 * PostHog). Without a sink, tracking is a no-op.
 */

export type AnalyticsSink = (
  event: string,
  properties?: Record<string, unknown>,
) => void;

let sink: AnalyticsSink | null = null;

/** Install the host's event sink. Called once at bootstrap. */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
}

export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  sink?.(event, properties);
}
