import type { VFSNodeId } from '@myelin/editor/sync/repo/types';

export * from '@myelin/editor/sync/repo/types';

export interface NoteIndexItem {
  nodeId: VFSNodeId;
  path: string;
}

export interface NoteFlag {
  noteId: VFSNodeId;
  noteName: string;
  id: string;
  /** Empty when the flag was placed away from any PDF page or page frame. */
  label: string;
  /** Unresolved; see `resolveFlagType`. */
  flagTypeId: string;
}

export interface RenameReferencesRequest {
  sourceIds: readonly VFSNodeId[];
  targetId: string;
  newName: string;
  referenceKind: 'note' | 'page-frame';
}

export interface RenameReferencesResult {
  sourceCount: number;
  linkCount: number;
}

export type FileImportSource =
  | { kind: 'path'; path: string }
  | { kind: 'scoped'; folderId: string; path: string };
