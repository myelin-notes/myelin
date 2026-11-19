/**
 * Some WKWebView builds on older macOS ship a WebKit older than Safari 15.4,
 * which lacks `structuredClone`, `crypto.randomUUID` and `Array.prototype.at`.
 * Calling any of them throws and stops Myelin from starting at all. Imported
 * first from main.tsx so these are installed before any module that uses them.
 */
import polyfillStructuredClone from '@ungap/structured-clone';

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone =
    polyfillStructuredClone as typeof globalThis.structuredClone;
}

if (typeof crypto.randomUUID !== 'function') {
  // RFC 4122 v4 from getRandomValues, which WebKit has had since Safari 11.
  crypto.randomUUID = () =>
    '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
      (
        Number(c) ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
      ).toString(16),
    ) as ReturnType<Crypto['randomUUID']>;
}

if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function at<T>(this: T[], index: number): T | undefined {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? i + this.length : i];
    },
  });
}
