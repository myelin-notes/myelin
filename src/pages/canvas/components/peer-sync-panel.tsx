import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Radio, X } from 'lucide-react';
import { TimeAgo } from '@/components/time-ago';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import {
  type NoteSession,
  type NoteSessionStatus,
  type PeerSnapshot,
  useRepositoryStatus,
} from '@/lib/sync';
import { IrohTransport } from '@/lib/sync/live/iroh';

const logger = new Logger('PeerSyncPanel');

type Phase = 'idle' | 'hosting' | 'joining' | 'connected';

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

function getRepositorySyncLabel(
  strings: ReturnType<typeof useMessages>,
  status: ReturnType<typeof useRepositoryStatus>,
) {
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [joinToken, setJoinToken] = useState('');
  const [shareToken, setShareToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [peerSnapshot, setPeerSnapshot] = useState<PeerSnapshot | null>(
    () => session?.getPeerSnapshot() ?? null,
  );
  const transportRef = useRef<IrohTransport | null>(null);

  useEffect(() => {
    if (!session) {
      setPeerSnapshot(null);
      return;
    }

    setPeerSnapshot(session.getPeerSnapshot());
    return session.subscribePeerSnapshot(setPeerSnapshot);
  }, [session]);

  useEffect(() => {
    setPhase('idle');
    setJoinToken('');
    setShareToken('');
    setError('');
    setCopied(false);

    return () => {
      const transport = transportRef.current;
      transportRef.current = null;
      void transport?.destroy().catch((error) => {
        logger.error('Failed to destroy transport on unmount', error);
      });
    };
  }, [session]);

  const cleanup = useCallback(async () => {
    session?.clearTransport();
    await transportRef.current?.destroy();
    transportRef.current = null;
    setPhase('idle');
    setJoinToken('');
    setShareToken('');
    setError('');
    setCopied(false);
  }, [session]);

  const host = useCallback(async () => {
    if (!session) {
      return;
    }
    await cleanup();
    setError('');
    const transport = new IrohTransport(session.id);
    transportRef.current = transport;
    transport.on('connected', () => setPhase('connected'));
    transport.on('disconnected', () => cleanup());
    session.setTransport(transport);
    try {
      const ticket = await transport.host();
      setShareToken(ticket);
      setPhase('hosting');
    } catch (err) {
      void transport.destroy().catch((error) => {
        logger.error('Failed to destroy transport after host error', error);
      });
      if (transportRef.current === transport) {
        transportRef.current = null;
      }
      session.clearTransport();
      setShareToken('');
      setError(String(err));
      setPhase('idle');
    }
  }, [session, cleanup]);

  const join = useCallback(async () => {
    if (!session || !joinToken.trim()) {
      return;
    }
    await cleanup();
    setError('');
    const transport = new IrohTransport(session.id);
    transportRef.current = transport;
    transport.on('connected', () => setPhase('connected'));
    transport.on('disconnected', () => cleanup());
    session.setTransport(transport);
    try {
      setPhase('joining');
      await transport.join(joinToken.trim());
    } catch (err) {
      void transport.destroy().catch((error) => {
        logger.error('Failed to destroy transport after join error', error);
      });
      if (transportRef.current === transport) {
        transportRef.current = null;
      }
      session.clearTransport();
      setError(String(err));
      setPhase('idle');
    }
  }, [session, joinToken, cleanup]);

  const copyShareToken = useCallback(() => {
    if (!shareToken) {
      return;
    }
    navigator.clipboard.writeText(shareToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareToken]);

  if (!session) {
    return null;
  }

  const writerLabel = peerSnapshot?.currentWriter
    ? peerSnapshot.currentWriter === peerSnapshot.localPeerId
      ? strings.common.you
      : formatPeerId(peerSnapshot.currentWriter)
    : strings.common.none;

  const peerCount = peerSnapshot?.connectedPeers.length ?? 0;
  const phaseLabel = strings.canvas.peerSync.sessionPhase[
    status?.phase ?? 'idle'
  ];
  const syncStatus =
    phase === 'connected'
      ? strings.canvas.peerSync.sessionPhase.live(phaseLabel)
      : phaseLabel;
  const repositorySyncLabel = getRepositorySyncLabel(strings, repositoryStatus);

  return (
    <div className="absolute bottom-6 left-6 z-[100] flex max-h-[calc(100dvh-4rem)] w-72 flex-col gap-2 overflow-y-auto rounded-xl bg-white/90 p-3 shadow-ambient backdrop-blur-[24px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Radio className="size-3.5 text-text-muted" />
          <span className="font-medium text-text-secondary text-xs">
            {strings.canvas.peerSync.title}
          </span>
        </div>
        {phase !== 'idle' && (
          <button
            type="button"
            onClick={cleanup}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-2 py-1 text-[10px] text-red-600">
          {error}
        </div>
      )}

      {phase === 'idle' && (
        <>
          <button
            type="button"
            onClick={host}
            className="rounded-lg bg-primary px-3 py-1.5 font-medium text-white text-xs hover:bg-primary/90"
          >
            {strings.canvas.peerSync.host}
          </button>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder={strings.canvas.peerSync.joinPlaceholder}
              className="min-w-0 flex-1 rounded-lg bg-surface px-2 py-1.5 font-mono text-[10px] text-text-secondary outline-none placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={join}
              disabled={!joinToken.trim()}
              className="rounded-lg bg-surface px-3 py-1.5 font-medium text-text-secondary text-xs hover:bg-hover-tint disabled:opacity-40"
            >
              {strings.canvas.peerSync.join}
            </button>
          </div>
        </>
      )}

      {phase === 'hosting' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted">
              {strings.canvas.peerSync.waitingForPeer}
            </span>
            <button
              type="button"
              onClick={copyShareToken}
              className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80"
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied ? strings.common.copied : strings.common.copy}
            </button>
          </div>
          <div className="break-all rounded-md bg-surface px-2 py-1.5 text-center font-mono text-[10px] text-text-primary">
            {shareToken}
          </div>
          <span className="text-center text-[10px] text-text-muted">
            {strings.canvas.peerSync.shareCode}
          </span>
        </div>
      )}

      {phase === 'joining' && (
        <span className="text-center text-[10px] text-text-muted">
          {strings.canvas.peerSync.connecting}
        </span>
      )}

      {phase === 'connected' && (
        <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5">
          <div className="size-1.5 rounded-full bg-green-500" />
          <span className="font-medium text-green-700 text-xs">
            {strings.canvas.peerSync.connected}
          </span>
        </div>
      )}

      {peerSnapshot && (
        <div className="flex flex-col gap-2 rounded-lg bg-surface px-3 py-2">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{strings.canvas.peerSync.sync}</span>
            <span className="font-medium text-text-secondary">
              {syncStatus}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-md bg-white/80 px-2 py-1.5">
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

            <div className="rounded-md bg-white/80 px-2 py-1.5">
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

          <div className="rounded-md bg-white/80 px-2 py-1.5 text-[10px]">
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
              <div className="rounded-md bg-white/80 px-2 py-1.5 text-[10px] text-text-muted">
                {strings.canvas.peerSync.noRemotePeers}
              </div>
            ) : (
              peerSnapshot.connectedPeers.map((peer) => (
                <div
                  key={peer.peerId}
                  className="flex items-center justify-between rounded-md bg-white/80 px-2 py-1.5 text-[10px]"
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
