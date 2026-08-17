// Polyfill structuredClone before anything else loads; older WKWebView builds
// lack it and would crash the app during module evaluation.
import '@/lib/structured-clone-polyfill';

import { reportFatalError } from '@/lib/fatal-error';
import { applyMobileViewportScale } from '@/lib/viewport-scale';

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

// Before the app module graph loads, so the first paint is already scaled and
// every breakpoint the app reads sees the post-scale viewport.
applyMobileViewportScale();

void import('./bootstrap').catch((error) => {
  void reportFatalError('bootstrap-import', error);
});
