import type { PeerMode, SyncMessage } from './protocol';

export interface ConnectedPeer {
  peerId: string;
  mode: PeerMode;
  lastSeenAt: number;
}

export interface PeerSnapshot {
  localPeerId: string;
  localMode: PeerMode;
  connectedPeers: Array<{
    peerId: string;
    mode: PeerMode;
  }>;
  currentWriter: string | null;
  isWriter: boolean;
}

function sortPeerIds(a: { peerId: string }, b: { peerId: string }): number {
  return a.peerId.localeCompare(b.peerId);
}

export class PeerState {
  private readonly connectedPeers = new Map<string, ConnectedPeer>();

  constructor(
    private readonly localPeerId: string,
    private readonly localMode: PeerMode,
  ) {}

  public applyMessage(message: SyncMessage, now: number): boolean {
    if (message.type !== 'peer') {
      return false;
    }

    if (message.peerId === this.localPeerId) {
      return false;
    }

    if (message.kind === 'left') {
      return this.removePeer(message.peerId);
    }

    const existing = this.connectedPeers.get(message.peerId);
    if (!existing) {
      this.connectedPeers.set(message.peerId, {
        peerId: message.peerId,
        mode: message.mode,
        lastSeenAt: now,
      });
      return true;
    }

    const changed = existing.mode !== message.mode;
    existing.mode = message.mode;
    existing.lastSeenAt = now;
    return changed;
  }

  public removePeer(peerId: string): boolean {
    if (peerId === this.localPeerId) {
      return false;
    }

    return this.connectedPeers.delete(peerId);
  }

  public pruneStalePeers(now: number, timeoutMs: number): boolean {
    let changed = false;
    for (const [peerId, peer] of this.connectedPeers.entries()) {
      if (now - peer.lastSeenAt > timeoutMs) {
        this.connectedPeers.delete(peerId);
        changed = true;
      }
    }
    return changed;
  }

  public resetRemotePeers(): boolean {
    if (this.connectedPeers.size === 0) {
      return false;
    }

    this.connectedPeers.clear();
    return true;
  }

  public getSnapshot(): PeerSnapshot {
    const connectedPeers = Array.from(this.connectedPeers.values())
      .map((peer) => ({
        peerId: peer.peerId,
        mode: peer.mode,
      }))
      .sort(sortPeerIds);

    const currentWriter = this.getCurrentWriter();

    return {
      localPeerId: this.localPeerId,
      localMode: this.localMode,
      connectedPeers,
      currentWriter,
      isWriter: currentWriter === this.localPeerId,
    };
  }

  private getCurrentWriter(): string | null {
    const eligiblePeerIds: string[] = [];

    if (this.localMode === 'owner-device') {
      eligiblePeerIds.push(this.localPeerId);
    }

    for (const peer of this.connectedPeers.values()) {
      if (peer.mode === 'owner-device') {
        eligiblePeerIds.push(peer.peerId);
      }
    }

    if (eligiblePeerIds.length === 0) {
      return null;
    }

    eligiblePeerIds.sort((a, b) => a.localeCompare(b));
    return eligiblePeerIds[0];
  }
}
