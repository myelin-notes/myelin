import { useCallback, useEffect, useRef } from 'react';
import { Logger } from '@/lib/logger';
import type { FileId, NoteSession } from '@/lib/sync';
import {
  regenerateThumbnailNow,
  requestThumbnailRegeneration,
} from '@/lib/thumbnails';

const AUTO_SAVE_INTERVAL_MS = 10_000;
const SAVE_DEBOUNCE_MS = 250;
const logger = new Logger('CanvasSessionSaveScheduler');

interface UseSessionSavingArgs {
  noteId: FileId | undefined;
  noteSession: NoteSession | null;
}

export function useCanvasSessionSaving({
  noteId,
  noteSession,
}: UseSessionSavingArgs) {
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  const noteSessionRef = useRef(noteSession);
  noteSessionRef.current = noteSession;

  const saveTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  const saveNow = useCallback(async (): Promise<void> => {
    const session = noteSessionRef.current;
    if (!session) {
      return;
    }

    if (savePromiseRef.current) {
      await savePromiseRef.current;
      if (session !== noteSessionRef.current || !session.hasUnsyncedChanges()) {
        return;
      }
    }

    const savePromise = session.save().finally(() => {
      if (savePromiseRef.current === savePromise) {
        savePromiseRef.current = null;
      }
    });
    savePromiseRef.current = savePromise;
    await savePromise;
  }, []);

  const clearScheduledSave = useCallback((): void => {
    if (saveTimerRef.current === null) {
      return;
    }

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const stopAutoSave = useCallback((): void => {
    if (autoSaveTimerRef.current === null) {
      return;
    }

    window.clearInterval(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
  }, []);

  const scheduleSave = useCallback((): void => {
    clearScheduledSave();
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveNow().catch((error) => {
        logger.error('Failed to save canvas session', error, {
          id: noteIdRef.current,
        });
      });
    }, SAVE_DEBOUNCE_MS);
  }, [clearScheduledSave, saveNow]);

  const startAutoSave = useCallback((): void => {
    if (autoSaveTimerRef.current !== null) {
      return;
    }

    autoSaveTimerRef.current = window.setInterval(() => {
      void saveNow().catch((error) => {
        logger.error('Auto-save failed', error, {
          id: noteIdRef.current,
        });
      });
    }, AUTO_SAVE_INTERVAL_MS);
  }, [saveNow]);

  const saveBeforeExit = useCallback(async (): Promise<void> => {
    clearScheduledSave();
    await saveNow();

    if (noteIdRef.current === undefined) {
      return;
    }

    try {
      await regenerateThumbnailNow(noteIdRef.current);
    } catch (error) {
      logger.error('Failed to regenerate thumbnail before exit', error, {
        id: noteIdRef.current,
      });
    }
  }, [clearScheduledSave, saveNow]);

  useEffect(() => {
    clearScheduledSave();
    stopAutoSave();

    if (!noteSession) {
      return;
    }

    const unsubscribeLocalChanges = noteSession.subscribeLocalChanges(() => {
      if (noteIdRef.current !== undefined) {
        requestThumbnailRegeneration(noteIdRef.current);
      }
      scheduleSave();
    });

    const unsubscribePeerSnapshot = noteSession.subscribePeerSnapshot(
      (snapshot) => {
        if (snapshot.isWriter) {
          startAutoSave();
          return;
        }
        stopAutoSave();
      },
    );

    return () => {
      clearScheduledSave();
      stopAutoSave();
      unsubscribeLocalChanges();
      unsubscribePeerSnapshot();
    };
  }, [
    clearScheduledSave,
    noteSession,
    scheduleSave,
    startAutoSave,
    stopAutoSave,
  ]);

  return {
    saveNow,
    saveBeforeExit,
    scheduleSave,
  };
}
