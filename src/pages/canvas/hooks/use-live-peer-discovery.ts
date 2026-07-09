import { useEffect, useState } from 'react';
import { LIVE_DISCOVERY_URL } from '@/lib/env';
import { Logger } from '@/lib/logger';
import { registerShutdownTask } from '@/lib/shutdown-tasks';
import {
  CloudflareLiveDiscoveryClient,
  createLiveDiscoveryRoomId,
  type NoteSession,
  useRepositoryStatus,
} from '@/lib/sync';
import { LivePeerDiscoveryCoordinator } from '@/lib/sync/live/discovery-coordinator';
import { getPlatform } from '@/platform';

const logger = new Logger('useLivePeerDiscovery');

export function useLivePeerDiscovery(
  noteSession: NoteSession | null,
): Error | null {
  const repositoryStatus = useRepositoryStatus();
  const [pauseError, setPauseError] = useState<Error | null>(null);

  useEffect(() => {
    setPauseError(null);
    // No live transport capability means this client can't join live sync.
    const createLiveTransport = getPlatform().createLiveTransport;
    if (!noteSession || !LIVE_DISCOVERY_URL || !createLiveTransport) {
      return;
    }

    let coordinator: LivePeerDiscoveryCoordinator | null = null;
    let disposed = false;
    let stopPromise: Promise<void> | null = null;
    const setLiveDiscoveryPause = (error: Error | null) => {
      if (!disposed) {
        setPauseError(error);
      }
    };

    const stopDiscovery = async () => {
      disposed = true;
      if (stopPromise) {
        await stopPromise;
        return;
      }

      const activeCoordinator = coordinator;
      coordinator = null;
      if (!activeCoordinator) {
        return;
      }

      stopPromise = activeCoordinator.stop().catch((error) => {
        logger.error('Failed to stop live peer discovery', error, {
          noteId: noteSession.id,
        });
      });
      await stopPromise;
    };
    const unregisterShutdownTask = registerShutdownTask(stopDiscovery);

    void (async () => {
      const roomId = await createLiveDiscoveryRoomId(
        repositoryStatus.config,
        noteSession.id,
      );
      if (disposed || !roomId) {
        return;
      }

      coordinator = new LivePeerDiscoveryCoordinator({
        session: noteSession,
        client: new CloudflareLiveDiscoveryClient({
          baseUrl: LIVE_DISCOVERY_URL,
          roomId,
        }),
        createTransport: (noteId) => createLiveTransport(noteId),
        onPauseChange: setLiveDiscoveryPause,
      });

      await coordinator.start();
    })().catch((error) => {
      setLiveDiscoveryPause(
        error instanceof Error ? error : new Error(String(error)),
      );
      logger.error('Failed to start live peer discovery', error, {
        noteId: noteSession.id,
      });
    });

    return () => {
      unregisterShutdownTask();
      void stopDiscovery();
    };
  }, [noteSession, repositoryStatus.config]);

  return pauseError;
}
