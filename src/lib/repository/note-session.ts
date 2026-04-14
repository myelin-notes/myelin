import { YDocManager } from '@/pages/free-canvas/ydoc-manager';
import type { NoteSession, NoteSessionStatus, YjsSyncTarget } from './types';

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

export class NoteSessionImpl implements NoteSession {
  public readonly status: NoteSessionStatus = {
    phase: 'idle',
    lastError: null,
    lastSyncedAt: Date.now(),
    remoteRevision: this.initialRevision,
  };

  private closed = false;
  private remoteStateVector: Uint8Array;

  constructor(
    public readonly id: string,
    public readonly ydoc: YDocManager,
    private readonly syncTarget: YjsSyncTarget,
    private readonly initialRevision: string | null,
    initialStateVector: Uint8Array,
  ) {
    this.remoteStateVector = initialStateVector;
  }

  static async open(
    nodeId: string,
    syncTarget: YjsSyncTarget,
  ): Promise<NoteSessionImpl> {
    const initial = await syncTarget.loadDocument(nodeId);
    const ydoc = initial.update
      ? YDocManager.fromUpdate(initial.update)
      : new YDocManager();
    return new NoteSessionImpl(
      nodeId,
      ydoc,
      syncTarget,
      initial.revision,
      initial.stateVector,
    );
  }

  encodeStateVector(): Uint8Array {
    return this.ydoc.encodeStateVector();
  }

  encodeUpdate(stateVector?: Uint8Array | null): Uint8Array {
    return this.ydoc.encodeDiff(stateVector);
  }

  applyUpdate(update: Uint8Array): void {
    this.ydoc.applyUpdate(update);
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
    this.closed = true;
    this.status.phase = 'closed';
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
