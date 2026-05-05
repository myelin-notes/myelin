export type FileId = string;

/**
 * Full or incremental snapshot of a document's sync state.
 *
 * `update` contains the Yjs changes needed to bring a local document forward.
 * `stateVector` describes the remote side's known state after that snapshot.
 * `revision` is repository-specific optimistic concurrency metadata and may be
 * null for backends that do not version documents explicitly.
 */
export interface YjsSyncSnapshot {
  /** Full document contents on initial load, or a diff on pull. */
  update: Uint8Array | null;
  /** Remote state after applying `update`. Used for future diff calculations. */
  stateVector: Uint8Array;
  /** Backend revision token used for optimistic writes when available. */
  revision: string | null;
}

/**
 * Context supplied when pushing local Yjs changes to a sync target.
 */
export interface YjsSyncPushOptions {
  /** Revision the caller believes it is writing against. */
  baseRevision: string | null;
  /** Optional caller-side state vector used by some backends during conflict resolution. */
  localStateVector?: Uint8Array | null;
}

/**
 * Result of attempting to push local changes to a sync target.
 *
 * When `accepted` is false, the backend rejected the write and may include
 * `remoteUpdate` so the caller can merge and retry.
 */
export interface YjsSyncPushResult extends YjsSyncSnapshot {
  /** Whether the backend accepted the pushed update. */
  accepted: boolean;
  /** Remote changes that should be applied locally before retrying a push. */
  remoteUpdate: Uint8Array | null;
}

/**
 * Minimal document-sync contract implemented by repositories that can store
 * note contents as Yjs documents.
 */
export interface YjsSyncTarget {
  /** Load the current document state for an initial session open. */
  loadDocument(nodeId: FileId): Promise<YjsSyncSnapshot>;
  /** Pull remote changes since the provided state vector, or full state if omitted. */
  pullUpdates(
    nodeId: FileId,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot>;
  /** Push local changes and receive the remote sync state after the attempt. */
  pushUpdates(
    nodeId: FileId,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult>;
}

/**
 * Observable sync status exposed by an open note session.
 */
export interface NoteSessionStatus {
  /** Current high-level sync activity for the session. */
  phase: 'idle' | 'pulling' | 'pushing' | 'closed';
  /** Most recent sync error, if any. */
  lastError: Error | null;
  /** Timestamp of the last successful sync operation. */
  lastSyncedAt: number | null;
  /** Latest known backend revision for the open document. */
  remoteRevision: string | null;
}
