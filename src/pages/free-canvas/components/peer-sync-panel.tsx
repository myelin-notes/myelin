import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Radio, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { PeerSync } from '@/lib/repository/peer-sync';
import type { YDocManager } from '../ydoc-manager';

type Phase = 'idle' | 'hosting' | 'joining' | 'connected';

interface PeerSyncPanelProps {
  ydoc: YDocManager | null;
}

export function PeerSyncPanel({ ydoc }: PeerSyncPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [joinAddr, setJoinAddr] = useState('');
  const [localIp, setLocalIp] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const peerRef = useRef<PeerSync | null>(null);

  useEffect(() => {
    invoke<string>('get_local_ip')
      .then(setLocalIp)
      .catch(() => setLocalIp('unknown'));
  }, []);

  const cleanup = useCallback(async () => {
    await peerRef.current?.destroy();
    peerRef.current = null;
    setPhase('idle');
    setJoinAddr('');
    setError('');
    setCopied(false);
  }, []);

  const host = useCallback(async () => {
    if (!ydoc) {
      return;
    }
    await cleanup();
    setError('');
    const peer = new PeerSync(ydoc);
    peerRef.current = peer;
    peer.onConnect = () => setPhase('connected');
    peer.onClose = () => cleanup();
    try {
      await peer.host(9090);
      setPhase('hosting');
    } catch (err) {
      setError(String(err));
    }
  }, [ydoc, cleanup]);

  const join = useCallback(async () => {
    if (!ydoc || !joinAddr.trim()) {
      return;
    }
    await cleanup();
    setError('');
    const peer = new PeerSync(ydoc);
    peerRef.current = peer;
    peer.onConnect = () => setPhase('connected');
    peer.onClose = () => cleanup();
    try {
      setPhase('joining');
      await peer.join(joinAddr.trim());
    } catch (err) {
      setError(String(err));
      setPhase('idle');
    }
  }, [ydoc, joinAddr, cleanup]);

  const copyAddr = useCallback(() => {
    const addr = `${localIp}:9090`;
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [localIp]);

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
            Host ({localIp || '...'})
          </button>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinAddr}
              onChange={(e) => setJoinAddr(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="IP:port (e.g. 192.168.1.5:9090)"
              className="min-w-0 flex-1 rounded-lg bg-surface px-2 py-1.5 font-mono text-[10px] text-text-secondary outline-none placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={join}
              disabled={!joinAddr.trim()}
              className="rounded-lg bg-surface px-3 py-1.5 font-medium text-text-secondary text-xs hover:bg-hover-tint disabled:opacity-40"
            >
              Join
            </button>
          </div>
        </>
      )}

      {phase === 'hosting' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted">
              Waiting for peer...
            </span>
            <button
              type="button"
              onClick={copyAddr}
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
          <div className="rounded-md bg-surface px-2 py-1.5 text-center font-mono text-text-primary text-xs">
            {localIp}:9090
          </div>
          <span className="text-center text-[10px] text-text-muted">
            Share this address with peer
          </span>
        </div>
      )}

      {phase === 'joining' && (
        <span className="text-center text-[10px] text-text-muted">
          Connecting...
        </span>
      )}

      {phase === 'connected' && (
        <div className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-1.5">
          <div className="size-1.5 rounded-full bg-green-500" />
          <span className="font-medium text-green-700 text-xs">Connected</span>
        </div>
      )}
    </div>
  );
}
