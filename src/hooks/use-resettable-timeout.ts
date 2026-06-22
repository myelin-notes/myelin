import { useCallback, useEffect, useRef } from 'react';

export function useResettableTimeout() {
  const timeoutRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current === null) {
      return;
    }

    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const schedule = useCallback(
    (callback: () => void, delayMs: number) => {
      clear();
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        callback();
      }, delayMs);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { schedule, clear };
}
