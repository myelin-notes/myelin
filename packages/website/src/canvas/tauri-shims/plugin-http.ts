// Browser stand-in for @tauri-apps/plugin-http: the platform fetch.
export const fetch: typeof globalThis.fetch = (...args) =>
  globalThis.fetch(...args);
