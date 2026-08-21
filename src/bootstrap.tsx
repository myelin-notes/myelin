import React from 'react';
import ReactDOM from 'react-dom/client';
import { setAnalyticsSink } from '@myelin/shared/analytics';
import { setLogErrorReporter, setLogSink } from '@myelin/shared/logger';
import { disableNativePinchZoom } from '@/lib/disable-native-pinch-zoom';
import { markBootComplete, reportFatalError } from '@/lib/fatal-error';
import { I18nProvider } from '@/lib/i18n';
import { flushLogs } from '@/lib/logger';
import { setPlatform } from '@/platform';
import { tauriPlatform } from '@/platform/tauri';
import { writeLogs } from '@/platform/tauri/log-sink';
import App from './App';
import { trackEvent } from './lib/analytics';
import {
  initErrorTracking,
  isErrorTrackingEnabled,
  posthog,
} from './lib/posthog';
import { initRustErrorReporting } from './lib/rust-errors';
import { RepositoryProvider } from './lib/sync';
import './index.css';

// Loaded via dynamic import from main.tsx so that a throw while *importing* any
// of the above (e.g. a Web API missing on an older OS) rejects that import and
// is reported, rather than silently blanking the window. The try/catch here
// covers throws during the synchronous startup calls below.
try {
  setPlatform(tauriPlatform);
  setLogSink(writeLogs);
  // Drain log lines queued while modules were importing (pre-sink).
  void flushLogs();
  initErrorTracking();
  // Editor-package seams: product events and error-level log reports flow to
  // PostHog through these host-installed hooks.
  setAnalyticsSink(trackEvent);
  setLogErrorReporter((error, context) => {
    if (!isErrorTrackingEnabled()) {
      return;
    }
    posthog.captureException(error, context);
  });
  initRustErrorReporting();
  disableNativePinchZoom();
  trackEvent('app_opened');

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <RepositoryProvider>
          <App />
        </RepositoryProvider>
      </I18nProvider>
    </React.StrictMode>,
  );

  markBootComplete();
} catch (error) {
  void reportFatalError('bootstrap', error);
}
