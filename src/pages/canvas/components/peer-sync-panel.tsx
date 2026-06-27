import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { TimeAgo } from '@/components/time-ago';
import { type Messages, useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import {
  type NoteSession,
  type NoteSessionStatus,
  type PeerSnapshot,
  type RepositoryStatus,
  useRepositoryStatus,
} from '@/lib/sync';

interface PeerSyncPanelProps {
  session: NoteSession | null;
  status: NoteSessionStatus | null;
}

function formatPeerId(peerId: string): string {
  if (peerId.length <= 12) {
    return peerId;
  }

  return `${peerId.slice(0, 8)}...${peerId.slice(-4)}`;
}

function getRepositorySyncLabel(strings: Messages, status: RepositoryStatus) {
  if (status.config.kind === 'local') {
    return strings.canvas.peerSync.repositoryStatus.localOnly;
  }

  if (status.initializing) {
    return strings.canvas.peerSync.repositoryStatus.initializing;
  }

  if (!status.online) {
    return strings.canvas.peerSync.repositoryStatus.offline;
  }

  if (status.pendingRemoteWrites > 0) {
    return strings.canvas.peerSync.repositoryStatus.queued(
      status.pendingRemoteWrites,
    );
  }

  if (status.lastRemoteSyncAt !== null) {
    return strings.canvas.peerSync.repositoryStatus.remoteSynced;
  }

  return strings.canvas.peerSync.repositoryStatus.idle;
}

export function PeerSyncPanel({ session, status }: PeerSyncPanelProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repositoryStatus = useRepositoryStatus();
  const [peerSnapshot, setPeerSnapshot] = useState<PeerSnapshot | null>(
    () => session?.getPeerSnapshot() ?? null,
  );

  useEffect(() => {
    if (!session) {
      setPeerSnapshot(null);
      return;
    }

    setPeerSnapshot(session.getPeerSnapshot());
    return session.subscribePeerSnapshot(setPeerSnapshot);
  }, [session]);

  if (!session) {
    return null;
  }

  const writerLabel = peerSnapshot?.currentWriter
    ? peerSnapshot.currentWriter === peerSnapshot.localPeerId
      ? strings.common.you
      : formatPeerId(peerSnapshot.currentWriter)
    : strings.common.none;

  const peerCount = peerSnapshot?.connectedPeers.length ?? 0;
  const syncStatus =
    strings.canvas.peerSync.sessionPhase[status?.phase ?? 'idle'];
  const repositorySyncLabel = getRepositorySyncLabel(strings, repositoryStatus);

  return (
    <div className="absolute bottom-6 left-6 z-[100] flex max-h-[calc(100dvh-4rem)] w-72 flex-col gap-2 overflow-y-auto rounded-xl bg-popover/90 p-3 shadow-ambient backdrop-blur-[24px]">
      <div className="flex items-center gap-1.5">
        <Radio className="size-3.5 text-text-muted" />
        <span className="font-medium text-text-secondary text-xs">
          {strings.canvas.peerSync.title}
        </span>
      </div>

      {peerSnapshot && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface px-3 py-2">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{strings.canvas.peerSync.sync}</span>
            <span className="font-medium text-text-secondary">
              {syncStatus}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-md bg-card/80 px-2 py-1.5">
              <div className="text-text-muted">
                {strings.canvas.peerSync.localPeer}
              </div>
              <div className="font-mono text-text-secondary">
                {formatPeerId(peerSnapshot.localPeerId)}
              </div>
              <div className="text-text-muted">
                {strings.canvas.peerSync.peerModes[peerSnapshot.localMode]}
              </div>
            </div>

            <div className="rounded-md bg-card/80 px-2 py-1.5">
              <div className="text-text-muted">
                {strings.canvas.peerSync.writer}
              </div>
              <div className="font-medium text-text-secondary">
                {writerLabel}
              </div>
              <div className="text-text-muted">
                {peerSnapshot.isWriter
                  ? strings.canvas.peerSync.writerActive
                  : strings.canvas.peerSync.standby}
              </div>
            </div>
          </div>

          <div className="rounded-md bg-card/80 px-2 py-1.5 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-text-muted">
                {strings.canvas.peerSync.repository}
              </span>
              <span className="font-medium text-text-secondary">
                {repositorySyncLabel}
              </span>
            </div>
            {repositoryStatus.lastRemoteSyncAt !== null &&
              repositoryStatus.config.kind !== 'local' && (
                <div className="text-text-muted">
                  {strings.canvas.peerSync.lastRemoteSync}{' '}
                  <TimeAgo date={repositoryStatus.lastRemoteSyncAt} />
                </div>
              )}
            {repositoryStatus.lastError && (
              <div className="mt-1 text-destructive">
                {repositoryStatus.lastError.message}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] text-text-muted">
              <span>{strings.canvas.peerSync.remotePeers}</span>
              <span>{formatNumber(peerCount, locale)}</span>
            </div>

            {peerCount === 0 ? (
              <div className="rounded-md bg-card/80 px-2 py-1.5 text-[10px] text-text-muted">
                {strings.canvas.peerSync.noRemotePeers}
              </div>
            ) : (
              peerSnapshot.connectedPeers.map((peer) => (
                <div
                  key={peer.peerId}
                  className="flex items-center justify-between rounded-md bg-card/80 px-2 py-1.5 text-[10px]"
                >
                  <span className="font-mono text-text-secondary">
                    {formatPeerId(peer.peerId)}
                  </span>
                  <span className="text-text-muted">
                    {strings.canvas.peerSync.peerModes[peer.mode]}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
