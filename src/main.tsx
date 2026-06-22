import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import App from './App';
import { initErrorTracking } from './lib/posthog';
import { RepositoryProvider } from './lib/sync';
import { initAutoUpdate } from './lib/updater';
import './index.css';

initErrorTracking();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <RepositoryProvider>
        <App />
      </RepositoryProvider>
    </I18nProvider>
  </React.StrictMode>,
);

void initAutoUpdate();
