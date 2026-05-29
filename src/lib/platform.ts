// Central place for runtime platform detection. Prefer these constants over
// inline checks so the logic stays consistent.
//
// We read `navigator.userAgent` rather than the deprecated `navigator.platform`.
// `navigator.userAgentData` isn't used because WKWebView (Tauri's macOS/iOS
// webview) doesn't implement it.

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

/**
 * Running on macOS (desktop). Use for OS-specific window chrome such as the
 * traffic-light inset on the tab bar.
 */
export const isMac = /Mac/.test(ua);

/**
 * Running on an Apple platform — macOS or iOS — where ⌘ is the primary
 * keyboard modifier. Use for keybindings and shortcut rendering.
 */
export const isApplePlatform = /Mac|iPhone|iPad/.test(ua);
