export type VFSNodeId = string;

/**
 * `update` holds the Yjs changes needed to bring a local document forward; `stateVector` describes
 * the remote's known state after that snapshot. `revision` is repository-specific optimistic
 * concurrency metadata, null for backends that don't version documents.
 */
export interface YjsSyncSnapshot {
  /** Full document contents on initial load, or a diff on pull. */
  update: Uint8Array | null;
  /** Remote state after applying `update`. Used for future diff calculations. */
  stateVector: Uint8Array;
  /** Backend revision token used for optimistic writes when available. */
  revision: string | null;
}

export interface DocumentSource {
  loadDocument(nodeId: VFSNodeId): Promise<YjsSyncSnapshot>;
}

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
