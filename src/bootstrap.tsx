import React from 'react';
import ReactDOM from 'react-dom/client';
import { setCanvasPerfEnabled } from '@myelin/editor/canvas-perf';
import { setMaxDevicePixelRatio } from '@myelin/editor/render-scale';
import { setAnalyticsSink } from '@myelin/shared/analytics';
import { setLogErrorReporter, setLogSink } from '@myelin/shared/logger';
import { disableNativePinchZoom } from '@/lib/disable-native-pinch-zoom';
import { IS_TABLET_BUILD } from '@/lib/env';
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
import { initAutoUpdate } from './lib/updater';
import './index.css';

// Loaded via dynamic import from main.tsx so that a throw while *importing* any
// of the above (e.g. a Web API missing on an older OS) rejects that import and
// is reported, rather than silently blanking the window. The try/catch here
// covers throws during the synchronous startup calls below.
try {
  setPlatform(tauriPlatform);
  // An iPad's DPR of 2 means each painting canvas layer rasterizes and
  // re-uploads 4x the logical pixel count every frame the view moves, which on
  // an older device is the whole frame budget. Frame rate scales with that
  // pixel count, so 1 buys 4x over native (2.25x over the 1.5 this used to be)
  // — a real cost in ink crispness, but ink that lags is worse than ink that is
  // soft. Page-frame text is DOM and stays sharp regardless.
  if (IS_TABLET_BUILD) {
    setMaxDevicePixelRatio(1);
    // A sideloaded iPad cannot reach Safari Web Inspector, so the canvas
    // status bar carries its own frame-time breakdown instead.
    setCanvasPerfEnabled(true);
  }
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

  void initAutoUpdate();
} catch (error) {
  void reportFatalError('bootstrap', error);
}
