import React from 'react';
import ReactDOM from 'react-dom/client';
import { markBootComplete, reportFatalError } from '@/lib/fatal-error';
import { I18nProvider } from '@/lib/i18n';
import { flushLogs } from '@/lib/logger';
import { setPlatform } from '@/platform';
import { tauriPlatform } from '@/platform/tauri';
import App from './App';
import { trackEvent } from './lib/analytics';
import { initErrorTracking } from './lib/posthog';
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
  // Drain log lines queued while modules were importing (pre-platform).
  void flushLogs();
  initErrorTracking();
  initRustErrorReporting();
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
