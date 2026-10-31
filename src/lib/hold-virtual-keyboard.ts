import { isTouchDevice } from '@myelin/shared/os';

// iOS only raises the keyboard for focus() inside a user gesture, so an input
// mounted after an await never gets one. Call this synchronously in the tap:
// the proxy brings the keyboard up, and a later focus() on the real input keeps it.
export function holdVirtualKeyboard(): void {
  if (!isTouchDevice) {
    return;
  }
  const proxy = document.createElement('input');
  proxy.tabIndex = -1;
  proxy.setAttribute('aria-hidden', 'true');
  // 16px stops iOS from zooming the page on focus.
  proxy.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
  document.body.append(proxy);
  proxy.addEventListener('blur', () => proxy.remove(), { once: true });
  proxy.focus({ preventScroll: true });
}
