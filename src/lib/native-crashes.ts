import posthog from 'posthog-js';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { invoke } from '@tauri-apps/api/core';

interface ExitDetails {
  reason: number;
  status: number;
  importance: number;
  pssKb: number;
  rssKb: number;
  description: string | null;
  signal: string | null;
  abortMessage: string | null;
  cause: string | null;
  thread: string | null;
  backtrace: string | null;
}

interface CrashReport {
  id: string;
  kind: 'native_crash' | 'webview_termination';
  reason: string;
  appVersion: string;
  platform: string;
  timestamp: string;
  distinctId: string | null;
  sessionId: string | null;
  code: number;
  detail: string;
  address: string;
  panics: string | null;
  exit: ExitDetails | null;
}

let configuration = Promise.resolve();
let generation = 0;

export function applyNativeCrashConsent(
  enabled: boolean,
  distinctId?: string,
  sessionId?: string,
): void {
  const currentGeneration = ++generation;
  configuration = configuration
    .catch(() => {})
    .then(async () => {
      const reports = await invoke<CrashReport[]>('configure_crash_reporting', {
        enabled,
        distinctId: distinctId ?? null,
        sessionId: sessionId ?? null,
      });
      for (const report of reports) {
        if (
          !enabled ||
          currentGeneration !== generation ||
          !UserPrefs.get('analyticsEnabled')
        ) {
          return;
        }
        posthog.captureException(report.reason, {
          distinct_id: report.distinctId ?? report.id,
          $exception_level: 'fatal',
          $exception_list: [
            {
              type:
                report.kind === 'native_crash'
                  ? 'NativeCrash'
                  : 'WebViewTermination',
              value: report.reason,
              mechanism: {
                type: report.kind,
                handled: false,
                synthetic: false,
              },
            },
          ],
          app_version: report.appVersion,
          $app_version: report.appVersion,
          platform: report.platform,
          crash_kind: report.kind,
          crash_report_id: report.id,
          crash_session_id: report.sessionId,
          crash_timestamp: report.timestamp,
          native_code: report.code,
          native_detail: report.detail,
          native_address: report.address,
          native_panics: report.panics,
          native_signal: report.exit?.signal,
          native_abort_message: report.exit?.abortMessage,
          native_cause: report.exit?.cause,
          native_thread: report.exit?.thread,
          native_backtrace: report.exit?.backtrace,
          exit_reason: report.exit?.reason,
          exit_status: report.exit?.status,
          exit_importance: report.exit?.importance,
          exit_description: report.exit?.description,
          exit_pss_kb: report.exit?.pssKb,
          exit_rss_kb: report.exit?.rssKb,
          reported_after_restart: true,
        });
        await invoke('acknowledge_crash_report', { id: report.id });
      }
    });
  void configuration.catch((error: unknown) => {
    console.warn('Could not configure or report native crashes', error);
  });
}
