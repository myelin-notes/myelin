import type { VFSNodeId } from '@myelin/editor/sync/repo/types';

export * from '@myelin/editor/sync/repo/types';

export interface NoteIndexItem {
  nodeId: VFSNodeId;
  path: string;
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
