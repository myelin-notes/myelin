import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logger } from '@/lib/logger';
import { summarizeYDocManager } from '@/lib/note-state-summary';
import type { NoteSession } from '@/lib/sync';
import {
  regenerateThumbnailNow,
  requestThumbnailRegeneration,
} from '@/lib/thumbnails';

const AUTO_SAVE_INTERVAL_MS = 10_000;
const LOCAL_PERSIST_DEBOUNCE_MS = 250;
const logger = new Logger('CanvasSessionPersistence');

interface UseCanvasSessionPersistenceArgs {
  id: string | undefined;
  noteSession: NoteSession | null;
}

export function useCanvasSessionPersistence({
  id,
  noteSession,
}: UseCanvasSessionPersistenceArgs) {
  const navigate = useNavigate();
  const noteSessionRef = useRef<NoteSession | null>(noteSession);
  const persistPromiseRef = useRef<Promise<void> | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    noteSessionRef.current = noteSession;
  }, [noteSession]);

  const persistSession = useCallback(
    async (session: NoteSession) => {
      if (persistPromiseRef.current) {
        await persistPromiseRef.current;
      }

      if (!session.hasUnsyncedChanges()) {
        return;
      }

      logger.debug('Persisting canvas session', {
        id,
        remoteRevision: session.status.remoteRevision,
        ...summarizeYDocManager(session.ydoc),
      });
      const persistPromise = session.push().finally(() => {
        if (persistPromiseRef.current === persistPromise) {
          persistPromiseRef.current = null;
        }
      });

      persistPromiseRef.current = persistPromise;
      await persistPromise;
      logger.debug('Persisted canvas session', {
        id,
        remoteRevision: session.status.remoteRevision,
        ...summarizeYDocManager(session.ydoc),
      });
    },
    [id],
  );

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

      void persistSession(session).catch((error) => {
        logger.error('Failed to persist session', error, { id });
      });
    }, LOCAL_PERSIST_DEBOUNCE_MS);
  }, [persistSession, id]);

  const autoSave = useCallback(async () => {
    const session = noteSessionRef.current;
    if (!session) {
      return;
    }

    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }

    if (!session.hasUnsyncedChanges()) {
      return;
    }

    const savePromise = persistSession(session).finally(() => {
      if (savePromiseRef.current === savePromise) {
        savePromiseRef.current = null;
      }
    });
    savePromiseRef.current = savePromise;
    await savePromise;
  }, [persistSession, id]);

  const back = useCallback(async () => {
    const session = noteSessionRef.current;
    logger.debug('Back navigation requested from canvas', {
      id,
      hasSession: session !== null,
      hasUnsyncedChanges: session?.hasUnsyncedChanges() ?? false,
      ...(session ? summarizeYDocManager(session.ydoc) : {}),
    });
    await autoSave();
    if (id !== undefined) {
      try {
        await regenerateThumbnailNow(id);
      } catch (error) {
        logger.error('Failed to regenerate thumbnail on back', error, { id });
      }
    }
    logger.debug('Navigating back to library from canvas', { id });
    navigate('/library');
  }, [autoSave, id, navigate]);

  useEffect(() => {
    if (!noteSession) {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      return;
    }

    const unsubscribe = noteSession.subscribeLocalChanges(() => {
      if (id !== undefined) {
        requestThumbnailRegeneration(id);
      }
      scheduleLocalPersist();
    });

    return () => {
      unsubscribe();
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [noteSession, scheduleLocalPersist, id]);

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
        void autoSave().catch((error) => {
          logger.error('Auto-save failed', error, { id });
        });
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
  }, [autoSave, noteSession, id]);

  return {
    autoSave,
    back,
    resetPersistenceState() {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    },
  };
}
