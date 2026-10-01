import type { Channel } from '@tauri-apps/api/core';
import type { VFSManifest } from './shared';
import type {
  FileImportSource,
  FileType,
  FileVersion,
  RenameReferencesRequest,
  RenameReferencesResult,
  VFSFileNode,
} from './types';

export interface NativeDocument {
  updateBase64: string;
  stateVectorBase64: string;
  revision: string | null;
  generation: string;
}

export interface NativeDocumentWrite {
  stateVectorBase64: string;
  revision: string | null;
  generation: string;
  accepted: boolean;
  changed: boolean;
}

export interface NativeRevision {
  revision: string;
}

export interface NativeManifest extends NativeRevision {
  manifest: VFSManifest;
}

export interface NativeFile {
  bytesBase64: string;
  revision: string | null;
}

export interface WriteFileOperation {
  kind: 'write-file';
  node: VFSFileNode;
  bytesBase64: string;
  replace: boolean;
  overwriteRemote: boolean;
}

export interface UpdateDocumentOperation {
  kind: 'update-document';
  nodeId: string;
  updateBase64: string;
  origin: 'local';
  generation: string | null;
  sourceSession: string | null;
}

export interface OneNoteImportProgress {
  current: number;
  total: number;
  fileName: string;
}

export interface OneNoteImportRequest {
  path: string;
  parentId: string | null;
  rootName: string;
  fallbackTitle: string;
  progress: Channel<OneNoteImportProgress>;
}

export interface OneNoteImportResult {
  rootFolderId: string;
  pagesImported: number;
  skippedPages: number;
}

export interface NativeOperationRequests {
  manifest: { kind: 'manifest' };
  'save-manifest': {
    kind: 'save-manifest';
    manifest: VFSManifest;
    revision: string;
  };
  'read-file': { kind: 'read-file'; nodeId: string };
  'write-file': WriteFileOperation;
  'import-file': {
    kind: 'import-file';
    node: VFSFileNode;
    source: FileImportSource;
  };
  'import-one-note': OneNoteImportRequest & { kind: 'import-one-note' };
  'rename-references': RenameReferencesRequest & { kind: 'rename-references' };
  'create-file-version': {
    kind: 'create-file-version';
    nodeId: string;
    force: boolean;
  };
  'restore-file-version': {
    kind: 'restore-file-version';
    nodeId: string;
    versionId: string;
  };
  'delete-file': {
    kind: 'delete-file';
    nodeId: string;
    fileType: FileType | null;
  };
  document: {
    kind: 'document';
    nodeId: string;
    stateVectorBase64: string | null;
  };
  'checkpoint-document': { kind: 'checkpoint-document'; nodeId: string };
  'update-document': UpdateDocumentOperation;
  subscribe: { kind: 'subscribe'; nodeId: string; sessionId: string };
  unsubscribe: { kind: 'unsubscribe'; nodeId: string; sessionId: string };
  path: { kind: 'path'; nodeId: string };
  'stage-bytes': {
    kind: 'stage-bytes';
    transferId: string;
    offset: number;
    bytesBase64: string;
  };
  'cancel-transfer': { kind: 'cancel-transfer'; transferId: string };
  'finish-transfer': {
    kind: 'finish-transfer';
    transferId: string;
    operation: WriteFileOperation | UpdateDocumentOperation;
  };
}

export interface NativeOperationResults {
  manifest: NativeManifest;
  'save-manifest': NativeRevision;
  'read-file': NativeFile;
  'write-file': NativeRevision;
  'import-file': NativeRevision;
  'import-one-note': OneNoteImportResult;
  'rename-references': RenameReferencesResult;
  'create-file-version': FileVersion | null;
  'restore-file-version': null;
  'delete-file': null;
  document: NativeDocument;
  'checkpoint-document': null;
  'update-document': NativeDocumentWrite;
  subscribe: null;
  unsubscribe: null;
  path: string | null;
  'stage-bytes': null;
  'cancel-transfer': null;
  'finish-transfer': NativeRevision | NativeDocumentWrite;
}
