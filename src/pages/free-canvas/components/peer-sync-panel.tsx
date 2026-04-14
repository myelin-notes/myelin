import { useCallback, useRef, useState } from 'react';
import { Check, Copy, Radio, X } from 'lucide-react';
import { PeerSync } from '@/lib/repository/peer-sync';
import type { YDocManager } from '../ydoc-manager';

type Phase = 'idle' | 'waiting-for-answer' | 'waiting-for-offer' | 'connected';

interface PeerSyncPanelProps {
  ydoc: YDocManager | null;
}

export function PeerSyncPanel({ ydoc }: PeerSyncPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [signal, setSignal] = useState('');
  const [remoteSignal, setRemoteSignal] = useState('');
  const [copied, setCopied] = useState(false);
  const peerRef = useRef<PeerSync | null>(null);

  const cleanup = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    setPhase('idle');
    setSignal('');
    setRemoteSignal('');
    setCopied(false);
  }, []);

  const initPeer = useCallback(
    (initiator: boolean) => {
      if (!ydoc) return;
      cleanup();
      setPhase(initiator ? 'waiting-for-answer' : 'waiting-for-offer');
      const peer = new PeerSync(ydoc, initiator);
      peerRef.current = peer;
      peer.onSignal = (s) => setSignal(s);
      peer.onConnect = () => setPhase('connected');
      peer.onClose = cleanup;
    },
    [ydoc, cleanup],
  );

  const host = useCallback(() => initPeer(true), [initPeer]);
  const join = useCallback(() => initPeer(false), [initPeer]);

  const submitRemoteSignal = useCallback(() => {
    if (!peerRef.current || !remoteSignal.trim()) {
      return;
    }
    peerRef.current.acceptSignal(remoteSignal.trim());
    setRemoteSignal('');
  }, [remoteSignal]);

  const copySignal = useCallback(() => {
    navigator.clipboard.writeText(signal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [signal]);

  if (!ydoc) {
    return null;
  }

  return (
    <div className="absolute bottom-6 left-6 z-10 flex w-72 flex-col gap-2 rounded-xl bg-white/90 p-3 shadow-ambient backdrop-blur-[24px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Radio className="size-3.5 text-text-muted" />
          <span className="font-medium text-text-secondary text-xs">
            Peer Sync
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

      {phase === 'idle' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={host}
            className="flex-1 rounded-lg bg-primary px-3 py-1.5 font-medium text-white text-xs hover:bg-primary/90"
          >
            Host
          </button>
          <button
            type="button"
            onClick={join}
            className="flex-1 rounded-lg bg-surface px-3 py-1.5 font-medium text-text-secondary text-xs hover:bg-hover-tint"
          >
            Join
          </button>
        </div>
      )}

      {phase === 'waiting-for-answer' &&
        (signal ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">
                Send this to peer:
              </span>
              <button
                type="button"
                onClick={copySignal}
                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80"
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              readOnly
              value={signal}
              className="h-16 resize-none rounded-md bg-surface p-2 font-mono text-[9px] text-text-secondary"
            />
            <span className="text-[10px] text-text-muted">
              Paste answer from peer:
            </span>
            <textarea
              value={remoteSignal}
              onChange={(e) => setRemoteSignal(e.target.value)}
              placeholder="Paste answer here..."
              className="h-16 resize-none rounded-md bg-surface p-2 font-mono text-[9px] text-text-secondary placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={submitRemoteSignal}
              disabled={!remoteSignal.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 font-medium text-white text-xs hover:bg-primary/90 disabled:opacity-40"
            >
              Connect
            </button>
          </>
        ) : (
          <span className="text-center text-[10px] text-text-muted">
            Generating offer...
          </span>
        ))}

      {phase === 'waiting-for-offer' &&
        (!signal ? (
          <>
            <span className="text-[10px] text-text-muted">
              Paste offer from host:
            </span>
            <textarea
              value={remoteSignal}
              onChange={(e) => setRemoteSignal(e.target.value)}
              placeholder="Paste offer here..."
              className="h-16 resize-none rounded-md bg-surface p-2 font-mono text-[9px] text-text-secondary placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={submitRemoteSignal}
              disabled={!remoteSignal.trim()}
              className="rounded-lg bg-primary px-3 py-1.5 font-medium text-white text-xs hover:bg-primary/90 disabled:opacity-40"
            >
              Generate Answer
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">
                Send this back to host:
              </span>
              <button
                type="button"
                onClick={copySignal}
                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80"
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea
              readOnly
              value={signal}
              className="h-16 resize-none rounded-md bg-surface p-2 font-mono text-[9px] text-text-secondary"
            />
            <span className="text-center text-[10px] text-text-muted">
              Waiting for connection...
            </span>
          </>
        ))}

      {phase === 'connected' && (
        <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5">
          <div className="size-1.5 rounded-full bg-green-500" />
          <span className="font-medium text-green-700 text-xs">Connected</span>
        </div>
      )}
    </div>
  );
}
