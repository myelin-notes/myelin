export interface YjsSyncSnapshot {
  update: Uint8Array | null;
  stateVector: Uint8Array;
  revision: string | null;
}

export interface YjsSyncPushOptions {
  baseRevision: string | null;
  localStateVector?: Uint8Array | null;
}

export interface YjsSyncPushResult extends YjsSyncSnapshot {
  accepted: boolean;
  remoteUpdate: Uint8Array | null;
}

export interface YjsSyncTarget {
  loadDocument(nodeId: string): Promise<YjsSyncSnapshot>;
  pullUpdates(
    nodeId: string,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot>;
  pushUpdates(
    nodeId: string,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult>;
}

export interface NoteSessionStatus {
  phase: 'idle' | 'pulling' | 'pushing' | 'closed';
  lastError: Error | null;
  lastSyncedAt: number | null;
  remoteRevision: string | null;
}
