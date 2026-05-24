import { useEffect } from 'react';
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
import { IrohTransport } from '@/lib/sync/live/iroh';

const logger = new Logger('useLivePeerDiscovery');

export function useLivePeerDiscovery(noteSession: NoteSession | null): void {
  const repositoryStatus = useRepositoryStatus();

  useEffect(() => {
    if (!noteSession || !LIVE_DISCOVERY_URL) {
      return;
    }

    let coordinator: LivePeerDiscoveryCoordinator | null = null;
    let disposed = false;
    let stopPromise: Promise<void> | null = null;

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
        createTransport: (noteId) => new IrohTransport(noteId),
      });

      await coordinator.start();
    })().catch((error) => {
      logger.error('Failed to start live peer discovery', error, {
        noteId: noteSession.id,
      });
    });

    return () => {
      unregisterShutdownTask();
      void stopDiscovery();
    };
  }, [noteSession, repositoryStatus.config]);
}
