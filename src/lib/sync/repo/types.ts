/**
 * App-side repository types. The persistence contract itself lives in
 * `@myelin/editor` (the editor consumes repositories without opening
 * sessions); the app layers session opening on top, since `NoteSession`
 * carries the app's live-sync machinery.
 */

import type {
  Repository as EditorRepository,
  FileType,
  VFSNodeId,
} from '@myelin/editor/sync/repo/types';
import type { NoteSession } from '../session';

export * from '@myelin/editor/sync/repo/types';

export interface NoteIndexItem {
  nodeId: VFSNodeId;
  path: string;
}

export interface OpenSessionOptions {
  /** Newly created local files have no remote state to pull. */
  skipRemotePull?: boolean;
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

export interface Repository extends EditorRepository {
  importFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    source: FileImportSource,
  ): Promise<VFSNodeId>;
  renameReferences(
    request: RenameReferencesRequest,
  ): Promise<RenameReferencesResult>;
  getNoteIndexSource(): object;
  listNoteIndexItems(): Promise<NoteIndexItem[]>;
  openSession(
    nodeId: VFSNodeId,
    options?: OpenSessionOptions,
  ): Promise<NoteSession>;
}

export type { NoteSession };
