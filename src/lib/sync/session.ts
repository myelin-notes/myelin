import { DEBUG } from '@/lib/debug';
import { YDocManager } from '@/pages/free-canvas/ydoc-manager';
import { noopTransport, type Transport } from './live/transport';
import type { NoteSessionStatus, YjsSyncTarget } from './types';

const PEER_ORIGIN = 'remote-peer';

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
  public readonly status: NoteSessionStatus = {
    phase: 'idle',
    lastError: null,
    lastSyncedAt: Date.now(),
    remoteRevision: this.initialRevision,
  };

  private closed = false;
  private closing: Promise<void> | null = null;
  private remoteStateVector: Uint8Array;
  private transport: Transport = noopTransport;

  constructor(
    public readonly id: string,
    public readonly ydoc: YDocManager,
    private readonly syncTarget: YjsSyncTarget,
    private readonly initialRevision: string | null,
    initialStateVector: Uint8Array,
  ) {
    this.remoteStateVector = initialStateVector;

    this.ydoc.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== PEER_ORIGIN && this.transport.connected) {
        this.transport.send(new Uint8Array(update)).catch((err) => {
          if (DEBUG) {
            console.error('[NoteSession] transport send error:', err);
          }
        });
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

  setTransport(transport: Transport): void {
    if (this.closed) {
      return;
    }

    this.transport.off('message', this.onTransportMessage);
    this.transport.off('disconnected', this.onTransportDisconnected);
    this.transport.off('connected', this.onTransportConnected);

    this.transport = transport;

    transport.on('message', this.onTransportMessage);
    transport.on('disconnected', this.onTransportDisconnected);
    transport.on('connected', this.onTransportConnected);

    if (transport.connected) {
      this.sendInitialState();
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

  applyUpdate(update: Uint8Array, origin?: unknown): void {
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
    this.ydoc.applyUpdate(data, PEER_ORIGIN);
  };

  private onTransportConnected = () => {
    this.sendInitialState();
  };

  private onTransportDisconnected = () => {
    this.clearTransport();
  };

  private sendInitialState(): void {
    const state = this.ydoc.encodeDiff();
    this.transport.send(state).catch((err) => {
      if (DEBUG) {
        console.error('[NoteSession] initial sync error:', err);
      }
    });
  }

  private hasRemoteChanges(): boolean {
    return !bytesEqual(this.ydoc.encodeStateVector(), this.remoteStateVector);
  }

  private async closeInternal(): Promise<void> {
    let closeError: unknown = null;

    try {
      if (this.hasRemoteChanges()) {
        await this.push();
      }
    } catch (error) {
      closeError = error;
    }

    this.clearTransport();
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
}
