import { useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark';

export function useTheme(initial: ThemeMode = 'light') {
  const [mode, setMode] = useState<ThemeMode>(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
  }, [mode]);

  const toggle = () => {
    setMode((m) => (m === 'light' ? 'dark' : 'light'));
  };

  return { mode, setMode, toggle };
}
