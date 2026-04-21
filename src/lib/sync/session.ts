import { Logger } from '@/lib/logger';
import {
  LOCAL_ORIGIN,
  PEER_ORIGIN,
  type SyncOrigin,
  YDocManager,
} from '@/pages/canvas/ydoc-manager';
import { getOrCreatePeerId } from './identity';
import { type PeerSnapshot, PeerState } from './live/peer-state';
import {
  decodeMessage,
  encodeMessage,
  type PeerMessageKind,
  type PeerMode,
  type SyncMessage,
} from './live/protocol';
import { noopTransport, type Transport } from './live/transport';
import type { NoteSessionStatus, YjsSyncTarget } from './types';

const HEARTBEAT_INTERVAL_MS = 5_000;
const PEER_TIMEOUT_MS = 15_000;
const logger = new Logger('NoteSession');

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export class NoteSession {
  public readonly status: NoteSessionStatus;

  private closed = false;
  private closing: Promise<void> | null = null;
  private remoteStateVector: Uint8Array;
  private transport: Transport = noopTransport;
  private readonly localPeer: {
    peerId: string;
    mode: PeerMode;
  };
  private readonly peerState: PeerState;
  private readonly peerSnapshotListeners = new Set<
    (snapshot: PeerSnapshot) => void
  >();
  private readonly localChangeListeners = new Set<() => void>();
  // NoteSession is exercised in a Node test environment as well as the
  // browser/Tauri runtime, so timers intentionally go through globalThis.
  private heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null =
    null;

  constructor(
    public readonly id: string,
    public readonly ydoc: YDocManager,
    private readonly syncTarget: YjsSyncTarget,
    initialRevision: string | null,
    initialStateVector: Uint8Array,
  ) {
    this.localPeer = {
      peerId: getOrCreatePeerId(),
      mode: 'owner-device',
    };
    this.peerState = new PeerState(this.localPeer.peerId, this.localPeer.mode);
    this.status = {
      phase: 'idle',
      lastError: null,
      lastSyncedAt: Date.now(),
      remoteRevision: initialRevision,
    };
    this.remoteStateVector = initialStateVector;

    this.ydoc.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const syncOrigin = isSyncOrigin(origin) ? origin : null;

      if (syncOrigin !== PEER_ORIGIN && this.transport.connected) {
        this.sendMessage({
          type: 'yjs-update',
          data: new Uint8Array(update),
        });
      }

      if (
        syncOrigin !== PEER_ORIGIN &&
        origin !== undefined &&
        origin !== null
      ) {
        for (const listener of this.localChangeListeners) {
          listener();
        }
      }
    });
  }

  static async open(
    nodeId: string,
    syncTarget: YjsSyncTarget,
  ): Promise<NoteSession> {
    const initial = await syncTarget.loadDocument(nodeId);
    const ydoc = initial.update
      ? YDocManager.fromUpdate(initial.update)
      : new YDocManager();
    return new NoteSession(
      nodeId,
      ydoc,
      syncTarget,
      initial.revision,
      initial.stateVector,
    );
  }

  get transportConnected(): boolean {
    return this.transport.connected;
  }

  hasUnsyncedChanges(): boolean {
    return !bytesEqual(this.ydoc.encodeStateVector(), this.remoteStateVector);
  }

  getPeerSnapshot(): PeerSnapshot {
    return this.peerState.getSnapshot();
  }

  subscribePeerSnapshot(
    listener: (snapshot: PeerSnapshot) => void,
  ): () => void {
    this.peerSnapshotListeners.add(listener);
    listener(this.getPeerSnapshot());

    return () => {
      this.peerSnapshotListeners.delete(listener);
    };
  }

  subscribeLocalChanges(listener: () => void): () => void {
    this.localChangeListeners.add(listener);
    return () => {
      this.localChangeListeners.delete(listener);
    };
  }

  setTransport(transport: Transport): void {
    if (this.closed || this.transport === transport) {
      return;
    }

    const previousTransport = this.transport;

    if (previousTransport.connected) {
      this.sendPeerPresence('left', previousTransport);
    }

    previousTransport.off('message', this.onTransportMessage);
    previousTransport.off('disconnected', this.onTransportDisconnected);
    previousTransport.off('connected', this.onTransportConnected);
    this.stopHeartbeat();
    this.updatePeerSnapshot(this.peerState.resetRemotePeers());

    this.transport = transport;

    transport.on('message', this.onTransportMessage);
    transport.on('disconnected', this.onTransportDisconnected);
    transport.on('connected', this.onTransportConnected);

    if (transport.connected) {
      this.onTransportConnected();
    }
  }

  clearTransport(): void {
    this.setTransport(noopTransport);
  }

  encodeStateVector(): Uint8Array {
    return this.ydoc.encodeStateVector();
  }

  encodeUpdate(stateVector?: Uint8Array | null): Uint8Array {
    return this.ydoc.encodeDiff(stateVector);
  }

  applyUpdate(update: Uint8Array, origin?: SyncOrigin): void {
    this.ydoc.applyUpdate(update, origin);
  }

  async pull(): Promise<Uint8Array | null> {
    let pulledUpdate: Uint8Array | null = null;
    await this.runWithPhase('pulling', async () => {
      const result = await this.syncTarget.pullUpdates(
        this.id,
        this.ydoc.encodeStateVector(),
      );

      if (result.update && result.update.byteLength > 0) {
        this.ydoc.applyUpdate(result.update);
        pulledUpdate = result.update;
      }

      this.remoteStateVector = result.stateVector;
      this.status.remoteRevision = result.revision;
    });
    return pulledUpdate;
  }

  async push(): Promise<void> {
    await this.runWithPhase('pushing', async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const localStateVector = this.ydoc.encodeStateVector();
        if (bytesEqual(localStateVector, this.remoteStateVector)) {
          return;
        }

        const pendingUpdate = this.ydoc.encodeDiff(this.remoteStateVector);
        const result = await this.syncTarget.pushUpdates(
          this.id,
          pendingUpdate,
          {
            baseRevision: this.status.remoteRevision,
            localStateVector,
          },
        );

        this.remoteStateVector = result.stateVector;
        this.status.remoteRevision = result.revision;

        if (result.accepted) {
          return;
        }

        if (result.remoteUpdate && result.remoteUpdate.byteLength > 0) {
          this.ydoc.applyUpdate(result.remoteUpdate);
        }
      }

      throw new Error(
        'Failed to push Yjs updates after reconciling remote changes.',
      );
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    if (!this.closing) {
      this.closing = this.closeInternal();
    }

    await this.closing;
  }

  private onTransportMessage = (data: Uint8Array) => {
    const message = decodeMessage(data);
    if (!message) {
      return;
    }

    if (message.type === 'yjs-update') {
      this.ydoc.applyUpdate(message.data, PEER_ORIGIN);
      return;
    }

    this.updatePeerSnapshot(this.peerState.applyMessage(message, Date.now()));
  };

  private onTransportConnected = () => {
    this.sendInitialState();
    this.sendPeerPresence('hello');
    this.startHeartbeat();
  };

  private onTransportDisconnected = () => {
    this.clearTransport();
  };

  private sendInitialState(): void {
    this.sendMessage({
      type: 'yjs-update',
      data: this.ydoc.encodeDiff(),
    });
  }

  private async closeInternal(): Promise<void> {
    let closeError: unknown = null;

    try {
      if (this.hasUnsyncedChanges()) {
        await this.push();
      }
    } catch (error) {
      closeError = error;
    }

    this.clearTransport();
    this.stopHeartbeat();
    this.closed = true;
    this.status.phase = 'closed';

    if (closeError) {
      throw closeError;
    }
  }

  private async runWithPhase(
    phase: Exclude<NoteSessionStatus['phase'], 'idle' | 'closed'>,
    action: () => Promise<void>,
  ): Promise<void> {
    if (this.closed) {
      return;
    }

    this.status.phase = phase;
    try {
      await action();
      this.status.lastError = null;
      this.status.lastSyncedAt = Date.now();
      this.status.phase = 'idle';
    } catch (error) {
      this.status.lastError =
        error instanceof Error ? error : new Error(String(error));
      this.status.phase = 'idle';
      throw error;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      return;
    }

    this.heartbeatTimer = globalThis.setInterval(() => {
      this.sendPeerPresence('heartbeat');
      this.updatePeerSnapshot(
        this.peerState.pruneStalePeers(Date.now(), PEER_TIMEOUT_MS),
      );
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) {
      return;
    }

    globalThis.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendMessage(
    message: SyncMessage,
    transport: Transport = this.transport,
  ): void {
    if (!transport.connected) {
      return;
    }

    transport.send(encodeMessage(message)).catch((err) => {
      logger.error('Transport send error', err);
    });
  }

  private sendPeerPresence(
    kind: PeerMessageKind,
    transport: Transport = this.transport,
  ): void {
    this.sendMessage(
      {
        type: 'peer',
        peerId: this.localPeer.peerId,
        kind,
        mode: this.localPeer.mode,
      },
      transport,
    );
  }

  private updatePeerSnapshot(changed: boolean): void {
    if (!changed) {
      return;
    }

    const snapshot = this.getPeerSnapshot();
    for (const listener of this.peerSnapshotListeners) {
      listener(snapshot);
    }
  }
}

function isSyncOrigin(origin: unknown): origin is SyncOrigin {
  return origin === LOCAL_ORIGIN || origin === PEER_ORIGIN;
}
