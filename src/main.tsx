import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RepositoryProvider } from './lib/sync';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RepositoryProvider>
      <App />
    </RepositoryProvider>
  </React.StrictMode>,
);
