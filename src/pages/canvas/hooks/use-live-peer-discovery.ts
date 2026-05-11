import { useEffect } from 'react';
import { Logger } from '@/lib/logger';
import {
  type ActiveRepository,
  type NoteSession,
  useRepositoryStatus,
} from '@/lib/sync';
import { LivePeerDiscoveryCoordinator } from '@/lib/sync/live/discovery-coordinator';
import { IrohTransport } from '@/lib/sync/live/iroh';

const logger = new Logger('useLivePeerDiscovery');

export function useLivePeerDiscovery(
  noteSession: NoteSession | null,
  repository: ActiveRepository,
): void {
  const repositoryStatus = useRepositoryStatus();

  useEffect(() => {
    const mailbox = repository.liveDiscoveryMailbox;
    if (
      !noteSession ||
      !mailbox ||
      repositoryStatus.initializing ||
      !repositoryStatus.online
    ) {
      return;
    }

    const coordinator = new LivePeerDiscoveryCoordinator({
      session: noteSession,
      mailbox,
      createTransport: (noteId) => new IrohTransport(noteId),
    });

    void coordinator.start().catch((error) => {
      logger.error('Failed to start live peer discovery', error, {
        noteId: noteSession.id,
      });
    });

    return () => {
      void coordinator.stop().catch((error) => {
        logger.error('Failed to stop live peer discovery', error, {
          noteId: noteSession.id,
        });
      });
    };
  }, [
    noteSession,
    repository,
    repositoryStatus.initializing,
    repositoryStatus.online,
  ]);
}
