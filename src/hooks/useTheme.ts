import { useEffect } from 'react';
import type { UserPrefValue } from '@myelin/editor/user-prefs';
import { useUserPref } from '@/lib/use-user-pref';

export type ThemeMode = UserPrefValue<'theme'>;

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveDark(mode: ThemeMode): boolean {
  return mode === 'system' ? prefersDark() : mode === 'dark';
}

/**
 * Applies the persisted theme preference to <html>. Mount once near the root.
 * In 'system' mode it also tracks the OS colour-scheme so the app follows
 * light/dark changes live.
 */
export function useTheme() {
  const mode = useUserPref('theme');

  useEffect(() => {
    const apply = () => {
      document.documentElement.classList.toggle('dark', resolveDark(mode));
    };
    apply();

    if (mode !== 'system') {
      return;
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [mode]);
}
