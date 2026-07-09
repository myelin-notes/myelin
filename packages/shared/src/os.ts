// Central place for runtime platform detection. Prefer these constants over
// inline checks so the logic stays consistent.
//
// We read `navigator.userAgent` rather than the deprecated `navigator.platform`.
// `navigator.userAgentData` isn't used because WKWebView (Tauri's macOS/iOS
// webview) doesn't implement it.

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

// iPadOS 13+ reports "Macintosh" in its UA, but a real Mac has no touch screen
// (maxTouchPoints === 0) whereas iPad reports > 1. Used to keep desktop-only
// chrome (e.g. the traffic-light inset) off iPad.
const isTouchDevice =
  typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;

/**
 * Running on macOS (desktop). Use for OS-specific window chrome such as the
 * traffic-light inset on the tab bar.
 */
export const isMac = /Mac/.test(ua) && !isTouchDevice;

/**
 * Running on Windows (desktop). The window is frameless here (decorations:
 * false), so the tab bar doubles as the title bar and carries our own
 * minimize/maximize/close controls — see {@link WindowControls}.
 */
export const isWindows = /Win/.test(ua);

/**
 * Running on an Apple platform — macOS or iOS — where ⌘ is the primary
 * keyboard modifier. Use for keybindings and shortcut rendering.
 */
export const isApplePlatform = /Mac|iPhone|iPad/.test(ua);

/**
 * Running on a mobile OS (iOS / iPadOS / Android) rather than a desktop. Used
 * to hide desktop-only chrome such as the MCP, data-export, and keybinding
 * settings sections. A touchscreen Windows/Linux laptop is not mobile.
 */
export const isMobile =
  (isApplePlatform && isTouchDevice) || /Android/.test(ua);

/**
 * Tab-bar height class. On macOS the bar is shorter so the OS traffic-light
 * buttons (fixed ~16px below the window top) land vertically centered in it.
 * Shared across every tab bar so the geometry can't drift apart.
 */
export const TAB_BAR_HEIGHT_CLASS = isMac ? 'h-8' : 'h-10';

/**
 * Left inset applied to the top-left bar on macOS to clear the traffic-light
 * buttons (titleBarStyle: Overlay draws them over the top-left of the webview).
 */
export const TRAFFIC_LIGHT_INSET_CLASS = 'pl-[78px]';
