import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NoteSession } from '@/lib/sync';
import { ThumbnailCache } from '@/lib/thumbnail-cache';

const AUTO_SAVE_INTERVAL_MS = 10_000;
const LOCAL_PERSIST_DEBOUNCE_MS = 250;

interface UseCanvasSessionPersistenceArgs {
  id: string | undefined;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  noteSession: NoteSession | null;
}

export function useCanvasSessionPersistence({
  id,
  canvasRef,
  noteSession,
}: UseCanvasSessionPersistenceArgs) {
  const navigate = useNavigate();
  const noteSessionRef = useRef<NoteSession | null>(noteSession);
  const persistPromiseRef = useRef<Promise<void> | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const needsThumbnailSaveRef = useRef(false);

  useEffect(() => {
    noteSessionRef.current = noteSession;
  }, [noteSession]);

  const persistSession = useCallback(async (session: NoteSession) => {
    if (persistPromiseRef.current) {
      await persistPromiseRef.current;
    }

    if (!session.hasLocalChanges()) {
      return;
    }

    const persistPromise = session.push().finally(() => {
      if (persistPromiseRef.current === persistPromise) {
        persistPromiseRef.current = null;
      }
    });

    persistPromiseRef.current = persistPromise;
    await persistPromise;
  }, []);

  const scheduleLocalPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      const session = noteSessionRef.current;
      if (!session) {
        return;
      }

      void persistSession(session).catch(console.error);
    }, LOCAL_PERSIST_DEBOUNCE_MS);
  }, [persistSession]);

  const saveSession = useCallback(
    async (session: NoteSession) => {
      const canvas = canvasRef.current;
      if (!canvas || !id) {
        return;
      }

      await persistSession(session);

      if (!needsThumbnailSaveRef.current) {
        return;
      }

      needsThumbnailSaveRef.current = false;
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (blob === null) {
            needsThumbnailSaveRef.current = true;
            console.warn('Failed to generate thumbnail');
            reject();
            return;
          }
          await ThumbnailCache.save(id, blob);
          resolve();
        }, 'image/png');
      });
    },
    [canvasRef, id, persistSession],
  );

  const autoSave = useCallback(async () => {
    const session = noteSessionRef.current;
    if (!session) {
      return;
    }

    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }

    if (!session.hasLocalChanges() && !needsThumbnailSaveRef.current) {
      return;
    }

    const savePromise = saveSession(session).finally(() => {
      if (savePromiseRef.current === savePromise) {
        savePromiseRef.current = null;
      }
    });
    savePromiseRef.current = savePromise;
    await savePromise;
  }, [saveSession]);

  const back = useCallback(async () => {
    await autoSave();
    navigate('/library');
  }, [autoSave, navigate]);

  useEffect(() => {
    if (!noteSession) {
      needsThumbnailSaveRef.current = false;
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      return;
    }

    const unsubscribe = noteSession.subscribeLocalChanges(() => {
      needsThumbnailSaveRef.current = true;
      scheduleLocalPersist();
    });

    return () => {
      unsubscribe();
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [noteSession, scheduleLocalPersist]);

  useEffect(() => {
    if (!noteSession) {
      return;
    }

    let timer: number | null = null;

    const stopAutoSave = () => {
      if (timer === null) {
        return;
      }

      window.clearInterval(timer);
      timer = null;
    };

    const startAutoSave = () => {
      if (timer !== null) {
        return;
      }

      timer = window.setInterval(() => {
        void autoSave().catch(console.error);
      }, AUTO_SAVE_INTERVAL_MS);
    };

    const unsubscribe = noteSession.subscribePeerSnapshot((snapshot) => {
      if (snapshot.isWriter) {
        startAutoSave();
        return;
      }

      stopAutoSave();
    });

    return () => {
      unsubscribe();
      stopAutoSave();
    };
  }, [autoSave, noteSession]);

  return {
    autoSave,
    back,
    resetPersistenceState() {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      needsThumbnailSaveRef.current = false;
    },
  };
}
