/**
 * Peer presence types shared between the app's live-sync layer (which owns
 * the wire protocol and peer bookkeeping) and editor elements that coordinate
 * work across peers (audio transcription claims). The app feeds snapshots of
 * this shape into the canvas; the package never talks to the transport.
 */

export type PeerMode = 'owner-device' | 'guest-editor' | 'guest-viewer';

export interface LivePeer {
  peerId: string;
  mode: PeerMode;
}

/** What the local client knows about the live session it is part of. */
export interface LivePeersSnapshot {
  localMode: PeerMode;
  /** Remote peers currently present (excludes the local peer). */
  peers: readonly LivePeer[];
}
