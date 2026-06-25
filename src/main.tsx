import { reportFatalError } from '@/lib/fatal-error';

// Install global failure handlers BEFORE the app module graph loads, then pull
// the app in via dynamic import. Because the app is imported asynchronously, a
// throw while *importing* a dependency (not just while running it) rejects the
// import and is captured here instead of leaving a blank window. The normal
// Logger only writes once app code calls it, so without this a pre-mount
// failure is completely silent — no log, no on-screen error.
//
// fatal-error has no top-level imports of its own, so loading it cannot fail.
window.addEventListener('error', (event) => {
  void reportFatalError('window.error', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  void reportFatalError('unhandledrejection', event.reason);
});

void import('./bootstrap').catch((error) => {
  void reportFatalError('bootstrap-import', error);
});
