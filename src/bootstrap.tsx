import React from 'react';
import ReactDOM from 'react-dom/client';
import { toast } from 'sonner';
import { CustomColorsProvider } from '@myelin/editor/custom-colors';
import { FlagTypesProvider } from '@myelin/editor/flag-types';
import { getMessages, I18nProvider } from '@myelin/editor/i18n';
import { setUpgradePrompt } from '@myelin/editor/plan';
import { setPlatform } from '@myelin/editor/platform';
import { setAnalyticsSink } from '@myelin/shared/analytics';
import {
  flushLogs,
  setLogErrorReporter,
  setLogSink,
} from '@myelin/shared/logger';
import { disableNativePinchZoom } from '@/lib/disable-native-pinch-zoom';
import { markBootComplete, reportFatalError } from '@/lib/fatal-error';
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

const PRICING_URL = 'https://trymyelin.app/pricing';

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
  setUpgradePrompt(() => {
    const strings = getMessages().plan;
    toast(strings.proRequired, {
      action: {
        label: strings.upgrade,
        onClick: () => void tauriPlatform.openExternal(PRICING_URL),
      },
    });
  });
  setLogErrorReporter((error, context) => {
    if (!isErrorTrackingEnabled()) {
      return;
    }
    posthog.captureException(error, context);
  });
  initRustErrorReporting();
  disableNativePinchZoom();
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <I18nProvider>
        <RepositoryProvider>
          <CustomColorsProvider>
            <FlagTypesProvider>
              <App />
            </FlagTypesProvider>
          </CustomColorsProvider>
        </RepositoryProvider>
      </I18nProvider>
    </React.StrictMode>,
  );

  markBootComplete();
} catch (error) {
  void reportFatalError('bootstrap', error);
}
