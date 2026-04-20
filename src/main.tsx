import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { initializeLogging } from '@/lib/logger';
import App from './App';
import { RepositoryProvider } from './lib/sync';
import './index.css';

initializeLogging();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <RepositoryProvider>
        <App />
      </RepositoryProvider>
    </I18nProvider>
  </React.StrictMode>,
);
