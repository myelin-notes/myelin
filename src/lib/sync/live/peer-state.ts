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

export interface PeerState {
  localPeerId: string;
  localMode: PeerMode;
  connectedPeers: Map<string, ConnectedPeer>;
}

function sortPeerIds(a: { peerId: string }, b: { peerId: string }): number {
  return a.peerId.localeCompare(b.peerId);
}

function getCurrentWriter(state: PeerState): string | null {
  const eligiblePeerIds: string[] = [];

  if (state.localMode === 'owner-device') {
    eligiblePeerIds.push(state.localPeerId);
  }

  for (const peer of state.connectedPeers.values()) {
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

export function createPeerState(
  localPeerId: string,
  localMode: PeerMode,
): PeerState {
  return {
    localPeerId,
    localMode,
    connectedPeers: new Map(),
  };
}

export function applyPeerMessage(
  state: PeerState,
  message: SyncMessage,
  now: number,
): boolean {
  if (message.type !== 'peer') {
    return false;
  }

  if (message.peerId === state.localPeerId) {
    return false;
  }

  if (message.kind === 'left') {
    return removePeer(state, message.peerId);
  }

  const existing = state.connectedPeers.get(message.peerId);
  if (!existing) {
    state.connectedPeers.set(message.peerId, {
      peerId: message.peerId,
      mode: message.mode,
      lastSeenAt: now,
    });
    return true;
  }

  const modeChanged = existing.mode !== message.mode;
  existing.mode = message.mode;
  existing.lastSeenAt = now;
  return modeChanged;
}

export function removePeer(state: PeerState, peerId: string): boolean {
  if (peerId === state.localPeerId) {
    return false;
  }

  return state.connectedPeers.delete(peerId);
}

export function pruneStalePeers(
  state: PeerState,
  now: number,
  timeoutMs: number,
): boolean {
  let changed = false;
  for (const [peerId, peer] of state.connectedPeers.entries()) {
    if (now - peer.lastSeenAt > timeoutMs) {
      state.connectedPeers.delete(peerId);
      changed = true;
    }
  }
  return changed;
}

export function resetRemotePeers(state: PeerState): boolean {
  if (state.connectedPeers.size === 0) {
    return false;
  }

  state.connectedPeers.clear();
  return true;
}

export function getPeerSnapshot(state: PeerState): PeerSnapshot {
  const connectedPeers = Array.from(state.connectedPeers.values())
    .map((peer) => ({
      peerId: peer.peerId,
      mode: peer.mode,
    }))
    .sort(sortPeerIds);

  const currentWriter = getCurrentWriter(state);

  return {
    localPeerId: state.localPeerId,
    localMode: state.localMode,
    connectedPeers,
    currentWriter,
    isWriter: currentWriter === state.localPeerId,
  };
}
