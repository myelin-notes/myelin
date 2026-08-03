/**
 * Fills in APIs that browsers withhold outside a secure context.
 *
 * The bench is served over plain HTTP on a LAN address so a tablet can reach it
 * without a trusted certificate, and that is not a secure context. Safari then
 * does not expose `crypto.randomUUID`, which the engine calls for every element
 * id — so any scenario that creates an element throws, while empty-canvas
 * scenarios pass and hide the problem until late in a sweep.
 *
 * This is a property of how the bench is served, not a bug in the app: the
 * Tauri build runs on a custom scheme, which is a secure context, and gets the
 * real implementation.
 */
export function installSecureContextShims(): void {
  if (typeof crypto.randomUUID === 'function') {
    return;
  }
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    // `getRandomValues` is available in insecure contexts (unlike
    // `crypto.subtle`), so the ids are still properly random — only the
    // convenience wrapper is missing.
    value: (): string => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      // Version 4, variant 1, per RFC 4122.
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex: string[] = [];
      for (const byte of bytes) {
        hex.push(byte.toString(16).padStart(2, '0'));
      }
      return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
      ].join('-');
    },
  });
}
