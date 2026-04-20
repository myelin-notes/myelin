import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { initializeLogging } from '@/lib/logger';
import App from './App';
import { RepositoryProvider } from './lib/sync';
import './index.css';
import * as Sentry from '@sentry/react';

initializeLogging();
Sentry.init({
  dsn: 'https://accc52ccd8d9f95fa75ef02fe44db0ca@o4511254895001600.ingest.us.sentry.io/4511254923247616',
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <RepositoryProvider>
        <App />
      </RepositoryProvider>
    </I18nProvider>
  </React.StrictMode>,
);
