/**
 * Some WKWebView builds on older macOS ship a WebKit older than Safari 15.4,
 * which has no global `structuredClone`. That throws a ReferenceError during
 * module evaluation and stops Myelin from starting at all. Install a
 * full-fidelity polyfill before any module that depends on it loads — this is
 * imported first from main.tsx for exactly that reason.
 */
import polyfillStructuredClone from '@ungap/structured-clone';

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone =
    polyfillStructuredClone as typeof globalThis.structuredClone;
}
