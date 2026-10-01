import { mergeUpdates } from 'yjs';
import { summarizeYDocManager } from '@myelin/editor/note/state-summary';
import {
  noopTransport,
  type Transport,
} from '@myelin/editor/sync/live/transport';
import type { NoteSessionStatus, VFSNodeId } from '@myelin/editor/sync/types';
import {
  FRAGMENT_SWEEP_ORIGIN,
  PEER_ORIGIN,
  REPOSITORY_SYNC_ORIGIN,
  type SyncOrigin,
  YDocManager,
} from '@myelin/editor/ydoc-manager';
import { Logger } from '@myelin/shared/logger';
import { createEphemeralPeerId, getOrCreatePeerId } from './identity';
import { type PeerSnapshot, PeerState } from './live/peer-state';
import {
  decodeMessage,
  encodeMessage,
  type PeerMessageKind,
  type PeerMode,
  type SyncMessage,
} from './live/protocol';
import type {
  NativeDocumentSnapshot,
  NativeDocumentTarget,
} from './native-document-target';

const HEARTBEAT_INTERVAL_MS = 5_000;
const PEER_TIMEOUT_MS = 15_000;
const logger = new Logger('NoteSession');
type HeartbeatTimer = number | NodeJS.Timeout;

export class NoteSession {
  private closed = false;
  private closing: Promise<void> | null = null;
  private changeEpoch = 0;
  private remoteStateVector: Uint8Array;
  private flushedEpoch = 0;
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
  private readonly statusListeners = new Set<
    (status: NoteSessionStatus) => void
  >();
  // NoteSession is exercised in a Node test environment as well as the
  // browser/Tauri runtime, so timers intentionally go through globalThis.
  private heartbeatTimer: HeartbeatTimer | null = null;
  private operationQueue: Promise<void> = Promise.resolve();
  private status: NoteSessionStatus;
  private nativeQueue: Uint8Array[] = [];
  private readonly nativeGeneration: string;
  private readonly nativeSessionId = createEphemeralPeerId();
  private replaced = false;
  private readonly replacementListeners = new Set<() => void>();
  private nativeSaving: Promise<void> | null = null;
  private unsubscribeNative: (() => Promise<void>) | null = null;

  private constructor(
    public readonly id: VFSNodeId,
    public readonly ydoc: YDocManager,
    private readonly syncTarget: NativeDocumentTarget,
    initial: NativeDocumentSnapshot,
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
      remoteRevision: initial.revision,
    };
    this.remoteStateVector = initial.stateVector;
    this.nativeGeneration = initial.generation;

    this.ydoc.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (this.closed || this.replaced) {
        return;
      }

      if (origin !== PEER_ORIGIN && origin !== REPOSITORY_SYNC_ORIGIN) {
        this.nativeQueue.push(new Uint8Array(update));
        void this.drainNative().catch((error) =>
          this.setStatus({
            lastError:
              error instanceof Error ? error : new Error(String(error)),
          }),
        );
      }

      if (!isRemoteSyncOrigin(origin)) {
        this.changeEpoch += 1;
        for (const listener of this.localChangeListeners) {
          listener();
        }
      }
    });
  }

  static async open(
    nodeId: VFSNodeId,
    syncTarget: NativeDocumentTarget,
  ): Promise<NoteSession> {
    const initial = await syncTarget.loadDocument(nodeId);
    const ydoc = initial.update
      ? YDocManager.fromUpdate(initial.update)
      : new YDocManager();
    const session = new NoteSession(nodeId, ydoc, syncTarget, initial);
    try {
      session.unsubscribeNative = await syncTarget.subscribeDocument(
        nodeId,
        (change) => {
          if (session.closed || session.replaced) {
            return;
          }
          if (
            change.replacement ||
            change.generation !== session.nativeGeneration
          ) {
            session.invalidateNativeDocument();
            return;
          }
          if (change.update) {
            session.applyUpdate(
              change.update,
              change.origin === 'peer' ? PEER_ORIGIN : REPOSITORY_SYNC_ORIGIN,
            );
          }
        },
        session.nativeSessionId,
      );
      await session.pull();
    } catch (error) {
      await session.unsubscribeNative?.();
      session.ydoc.doc.destroy();
      throw error;
    }
    logger.info('Opened note session', {
      nodeId,
      revision: initial.revision,
      updateByteLength: initial.update?.byteLength ?? 0,
      stateVectorByteLength: initial.stateVector.byteLength,
      ...summarizeYDocManager(session.ydoc),
    });
    return session;
  }

  get documentReplaced(): boolean {
    return this.replaced;
  }

  private invalidateNativeDocument(): void {
    this.replaced = true;
    this.nativeQueue = [];
    this.flushedEpoch = this.changeEpoch;
    for (const listener of this.replacementListeners) {
      listener();
    }
  }

  subscribeReplacement(listener: () => void): () => void {
    this.replacementListeners.add(listener);
    return () => {
      this.replacementListeners.delete(listener);
    };
  }

  get transportConnected(): boolean {
    return this.transport.connected;
  }

  get localPeerId(): string {
    return this.localPeer.peerId;
  }

  hasUnsyncedChanges(): boolean {
    return this.changeEpoch !== this.flushedEpoch;
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

  subscribeStatus(listener: (status: NoteSessionStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);

    return () => {
      this.statusListeners.delete(listener);
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
    if (
      'bindRepository' in transport &&
      typeof transport.bindRepository === 'function'
    ) {
      transport.bindRepository(this.syncTarget.nativeRepositoryHandle);
    }

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
    return this.enqueueOperation(() => this.pullInternal());
  }

  async save(): Promise<boolean> {
    return this.enqueueOperation(() => this.saveInternal());
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    if (!this.closing) {
      this.closing = this.enqueueOperation(() => this.closeInternal());
    }

    await this.closing;
  }

  private async pullInternal(): Promise<Uint8Array | null> {
    if (this.closed) {
      return null;
    }

    let pulledUpdate: Uint8Array | null = null;
    let pulledUpdateByteLength = 0;
    logger.debug('Pulling note session updates', {
      nodeId: this.id,
      remoteRevision: this.status.remoteRevision,
      localStateVectorByteLength: this.ydoc.encodeStateVector().byteLength,
      ...summarizeYDocManager(this.ydoc),
    });
    await this.runWithPhase('pulling', async () => {
      const result = await this.syncTarget.pullUpdates(
        this.id,
        this.ydoc.encodeStateVector(),
      );

      if (result.generation !== this.nativeGeneration) {
        this.invalidateNativeDocument();
        return;
      }

      if (result.update && result.update.byteLength > 0) {
        this.ydoc.applyUpdate(result.update, REPOSITORY_SYNC_ORIGIN);
        pulledUpdate = result.update;
        pulledUpdateByteLength = result.update.byteLength;
      }

      this.remoteStateVector = result.stateVector;
      this.setStatus({ remoteRevision: result.revision });
    });
    logger.debug('Pulled note session updates', {
      nodeId: this.id,
      remoteRevision: this.status.remoteRevision,
      pulledUpdateByteLength,
      remoteStateVectorByteLength: this.remoteStateVector.byteLength,
      ...summarizeYDocManager(this.ydoc),
    });
    return pulledUpdate;
  }

  private async saveInternal(): Promise<boolean> {
    if (this.closed || this.replaced) {
      return false;
    }

    const targetChangeEpoch = this.changeEpoch;
    this.ydoc.sweepOrphanPageFrameFragments();
    await this.runWithPhase('pushing', () => this.drainNative());
    await this.syncTarget.flushDocument(this.id);
    const changed = targetChangeEpoch !== this.flushedEpoch;
    this.flushedEpoch = Math.max(this.flushedEpoch, targetChangeEpoch);
    return changed;
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
    this.sendPeerPresence('hello');
    this.startHeartbeat();
  };

  private onTransportDisconnected = () => {
    this.clearTransport();
  };

  private async closeInternal(): Promise<void> {
    let closeError: unknown = null;
    logger.debug('Closing note session', {
      nodeId: this.id,
      changeEpoch: this.changeEpoch,
      flushedEpoch: this.flushedEpoch,
      hasUnsyncedChanges: this.hasUnsyncedChanges(),
      remoteRevision: this.status.remoteRevision,
      ...summarizeYDocManager(this.ydoc),
    });

    try {
      await this.saveInternal();
    } catch (error) {
      closeError = error;
    }

    this.clearTransport();
    await this.unsubscribeNative?.();
    this.unsubscribeNative = null;
    this.stopHeartbeat();
    this.closed = true;
    this.setStatus({ phase: 'closed' });
    logger.info('Closed note session', {
      nodeId: this.id,
      changeEpoch: this.changeEpoch,
      flushedEpoch: this.flushedEpoch,
      hadCloseError: closeError !== null,
      remoteRevision: this.status.remoteRevision,
      ...summarizeYDocManager(this.ydoc),
    });

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

    this.setStatus({ phase });
    try {
      await action();
      this.setStatus({
        lastError: null,
        lastSyncedAt: Date.now(),
        phase: 'idle',
      });
    } catch (error) {
      const statusError =
        error instanceof Error ? error : new Error(String(error));
      this.setStatus({
        lastError: statusError,
        phase: this.closed ? 'closed' : 'idle',
      });
      throw statusError;
    }
  }

  private drainNative(): Promise<void> {
    if (this.nativeSaving) {
      return this.nativeSaving;
    }
    const target = this.syncTarget;
    this.nativeSaving = (async () => {
      while (this.nativeQueue.length && !this.replaced) {
        const count = this.nativeQueue.length;
        const result = await target.persistDocumentUpdate(
          this.id,
          count === 1
            ? this.nativeQueue[0]
            : mergeUpdates(this.nativeQueue.slice(0, count)),
          this.nativeGeneration,
          this.nativeSessionId,
        );
        this.nativeQueue.splice(0, count);
        this.remoteStateVector = result.stateVector;
        this.setStatus({
          remoteRevision: result.revision,
          lastError: null,
          lastSyncedAt: Date.now(),
        });
      }
    })().then(
      () => {
        this.nativeSaving = null;
        if (this.nativeQueue.length) {
          return this.drainNative();
        }
      },
      (error) => {
        this.nativeSaving = null;
        throw error;
      },
    );
    return this.nativeSaving;
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.operationQueue
      .catch(() => undefined)
      .then(operation);

    this.operationQueue = scheduled.then(
      () => undefined,
      () => undefined,
    );

    return scheduled;
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

  private setStatus(patch: Partial<NoteSessionStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
    };

    for (const listener of this.statusListeners) {
      listener(this.status);
    }
  }
}

function isRemoteSyncOrigin(origin: unknown): origin is SyncOrigin {
  return (
    origin === PEER_ORIGIN ||
    origin === REPOSITORY_SYNC_ORIGIN ||
    origin === FRAGMENT_SWEEP_ORIGIN
  );
}
