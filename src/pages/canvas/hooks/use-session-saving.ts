import { useCallback, useEffect, useRef } from 'react';
import { Logger } from '@/lib/logger';
import {
  type NoteSession,
  type Repository,
  useRepository,
  type VFSNodeId,
} from '@/lib/sync';
import {
  regenerateThumbnailNow,
  requestThumbnailRegeneration,
} from '@/lib/thumbnails';
import { saveSessionAndCreateVersion } from './session-version-history';

const AUTO_SAVE_INTERVAL_MS = 10_000;
const SAVE_DEBOUNCE_MS = 250;
const logger = new Logger('CanvasSessionSaveScheduler');

interface UseSessionSavingArgs {
  noteId: VFSNodeId | undefined;
  noteSession: NoteSession | null;
}

export function useCanvasSessionSaving({
  noteId,
  noteSession,
}: UseSessionSavingArgs) {
  const repository = useRepository();
  const repositoryRef = useRef(repository);
  repositoryRef.current = repository;

  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  const noteSessionRef = useRef(noteSession);
  noteSessionRef.current = noteSession;

  const saveTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  const saveSession = useCallback(
    async (
      session: NoteSession,
      saveRepository: Pick<Repository, 'createFileVersionIfDue'>,
      shouldContinue: () => boolean = () => true,
    ): Promise<void> => {
      if (savePromiseRef.current) {
        await savePromiseRef.current;
        if (!shouldContinue() || !session.hasUnsyncedChanges()) {
          return;
        }
      }

      const savePromise = saveSessionAndCreateVersion(
        session,
        saveRepository,
      ).finally(() => {
        if (savePromiseRef.current === savePromise) {
          savePromiseRef.current = null;
        }
      });
      savePromiseRef.current = savePromise;
      await savePromise;
    },
    [],
  );

  const saveNow = useCallback(async (): Promise<void> => {
    const session = noteSessionRef.current;
    if (!session) {
      return;
    }
    await saveSession(
      session,
      repositoryRef.current,
      () => session === noteSessionRef.current,
    );
  }, [saveSession]);

  const clearScheduledSave = useCallback((): void => {
    if (saveTimerRef.current === null) {
      return;
    }

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  }, []);

  const saveSessionBeforeExit = useCallback(
    async (
      session: NoteSession,
      id: VFSNodeId | undefined,
      saveRepository: Pick<Repository, 'createFileVersionIfDue'>,
    ): Promise<void> => {
      const hadUnsyncedChanges = session.hasUnsyncedChanges();
      clearScheduledSave();
      await saveSession(session, saveRepository);

      if (id === undefined || !hadUnsyncedChanges) {
        return;
      }

      void regenerateThumbnailNow(id).catch((error) => {
        logger.error('Failed to regenerate thumbnail before exit', error, {
          id,
        });
      });
    },
    [clearScheduledSave, saveSession],
  );

  const saveBeforeExit = useCallback(async (): Promise<void> => {
    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }

    const session = noteSessionRef.current;
    if (!session) {
      clearScheduledSave();
      return;
    }

    await saveSessionBeforeExit(
      session,
      noteIdRef.current,
      repositoryRef.current,
    );
  }, [clearScheduledSave, saveSessionBeforeExit]);

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

  useEffect(() => {
    clearScheduledSave();
    stopAutoSave();

    if (!noteSession) {
      return;
    }

    const cleanupNoteId = noteId;
    const cleanupRepository = repository;
    const cleanupSession = noteSession;
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
      stopAutoSave();
      void saveSessionBeforeExit(
        cleanupSession,
        cleanupNoteId,
        cleanupRepository,
      ).catch((error) => {
        logger.error('Failed to save canvas session before exit', error, {
          id: cleanupNoteId,
        });
      });
      unsubscribeLocalChanges();
      unsubscribePeerSnapshot();
    };
  }, [
    clearScheduledSave,
    noteId,
    noteSession,
    repository,
    scheduleSave,
    saveSessionBeforeExit,
    startAutoSave,
    stopAutoSave,
  ]);

  return {
    saveNow,
    saveBeforeExit,
    scheduleSave,
  };
}
