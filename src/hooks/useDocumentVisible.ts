import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/**
 * Whether the app is on screen. Turns false when a mobile app is backgrounded
 * or a desktop window is minimized — not on mere focus loss, since an
 * unfocused window (or an iPad Split View pane) is still visible.
 */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState === 'visible',
    () => true,
  );
}
