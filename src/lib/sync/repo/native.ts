import { NODES_DELETED_EVENT } from '@myelin/editor/events';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
} from '@myelin/editor/sync/types';
import { removeThumbnail } from '@myelin/editor/thumbnails';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  NativeDocumentChange,
  NativeDocumentSnapshot,
  NativeDocumentTarget,
} from '../native-document-target';
import { BaseRepository } from './base';
import type { RepositoryConfig, RepositoryRuntimeStatus } from './config';
import { getGitHubToken } from './github/credentials';
import { getGoogleDriveToken } from './google-drive/credentials';
import { noteContentIndex } from './note-content-index';
import type { VFSManifest } from './shared';
import type {
  CreateFileOptions,
  FileImportSource,
  FileType,
  FileVersion,
  RenameReferencesRequest,
  RenameReferencesResult,
  RepositoryCapabilities,
  VFSNodeId,
} from './types';

interface NativeStatus extends Omit<RepositoryRuntimeStatus, 'lastError'> {
  repositoryId: string;
  lastError: string | null;
}
interface NativeDocument {
  updateBase64: string;
  stateVectorBase64: string;
  revision: string | null;
  generation: string;
  accepted?: boolean;
  changed?: boolean;
}
interface DocumentEvent {
  repositoryId: string;
  nodeId: string;
  updateBase64?: string;
  origin: 'local' | 'peer' | 'repository';
  generation: string;
  replacement: boolean;
}
interface DataEvent {
  repositoryId: string;
  changed: string[];
  deleted: string[];
}
interface AuthEvent {
  repositoryId: string;
  credentialId: string;
  requestId: string;
  forceRefresh: boolean;
}

const logger = new Logger('NativeRepository');

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}
function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export class NativeRepository
  extends BaseRepository
  implements NativeDocumentTarget
{
  readonly capabilities: RepositoryCapabilities;
  readonly kind: string;
  private handle = '';
  private initializing: Promise<void> | null = null;
  private disposed = false;
  private readonly unlisteners: UnlistenFn[] = [];
  private nativeVersion = -1;

  constructor(
    private readonly config: RepositoryConfig,
    private readonly storageRoot = '',
  ) {
    super();
    this.kind = config.kind === 'local' ? 'local-storage' : config.kind;
    this.capabilities = {
      polling: false,
      liveSync: config.kind !== 'local',
      batchedCommit: config.kind === 'github',
    };
  }

  get nativeRepositoryHandle(): string {
    return this.handle;
  }
  private get repositoryId(): string {
    return this.storageRoot || 'local';
  }

  override initialize(): Promise<void> {
    this.initializing ??= this.open();
    return this.initializing;
  }

  private async open(): Promise<void> {
    try {
      this.unlisteners.push(
        await listen<NativeStatus>('repository-status', ({ payload }) => {
          if (payload.repositoryId === this.repositoryId && !this.disposed) {
            this.applyStatus(payload);
          }
        }),
      );
      this.unlisteners.push(
        await listen<DataEvent>('repository-data', ({ payload }) => {
          if (payload.repositoryId === this.repositoryId && !this.disposed) {
            void this.onData(payload).catch((error) =>
              logger.error('Could not refresh native repository index', error),
            );
          }
        }),
      );
      this.unlisteners.push(
        await listen<AuthEvent>('repository-auth-request', ({ payload }) => {
          if (
            payload.repositoryId !== this.repositoryId ||
            this.config.kind === 'local' ||
            payload.credentialId !== this.config.credentialId ||
            this.disposed
          ) {
            return;
          }
          void this.token(payload.forceRefresh).then(
            (token) =>
              invoke('repository_auth_response', {
                requestId: payload.requestId,
                token,
              }),
            (error) =>
              invoke('repository_auth_response', {
                requestId: payload.requestId,
                error: String(error),
              }),
          );
        }),
      );
      const token =
        this.config.kind === 'local'
          ? ''
          : await this.token(false).catch(() => '');
      const source =
        this.config.kind === 'local'
          ? null
          : this.config.kind === 'github'
            ? {
                kind: 'github',
                owner: this.config.owner,
                repo: this.config.repo,
                branch: this.config.branch ?? 'main',
                token,
              }
            : { kind: 'google-drive', folderId: this.config.folderId, token };
      const opened = await invoke<{ handle: string; status: NativeStatus }>(
        'repository_open',
        {
          request: {
            storageRoot: this.storageRoot,
            credentialId:
              this.config.kind === 'local' ? '' : this.config.credentialId,
            source,
          },
        },
      );
      this.handle = opened.handle;
      if (this.disposed) {
        await invoke('repository_release', { handle: this.handle });
        return;
      }
      this.applyStatus(opened.status);
      noteContentIndex.reconcile(this);
    } catch (error) {
      for (const unlisten of this.unlisteners.splice(0)) {
        unlisten();
      }
      throw error;
    }
  }

  private async token(forceRefresh: boolean): Promise<string> {
    if (this.config.kind === 'local') {
      return '';
    }
    return this.config.kind === 'github'
      ? getGitHubToken(this.config.credentialId)
      : getGoogleDriveToken(this.config.credentialId, { forceRefresh });
  }

  private applyStatus(status: NativeStatus): void {
    const dataVersion =
      this.getRuntimeStatus().dataVersion +
      (status.dataVersion !== this.nativeVersion ? 1 : 0);
    this.nativeVersion = status.dataVersion;
    this.updateRuntimeStatus({
      online: status.online,
      pendingRemoteWrites: status.pendingRemoteWrites,
      lastRemoteSyncAt: status.lastRemoteSyncAt,
      dataVersion,
      lastError: status.lastError ? new Error(status.lastError) : null,
    });
  }

  private async onData(data: DataEvent): Promise<void> {
    for (const id of data.deleted) {
      noteContentIndex.remove(this, id);
      await removeThumbnail(id);
    }
    if (data.deleted.length && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(NODES_DELETED_EVENT, { detail: { ids: data.deleted } }),
      );
    }
    if (!data.changed.length) {
      return;
    }
    const { manifest } = await this.loadManifestImpl();
    for (const id of data.changed) {
      const node = manifest.nodes[id];
      if (node?.type !== 'file' || node.fileType !== 'mcanvas' || node.system) {
        noteContentIndex.remove(this, id);
        continue;
      }
      noteContentIndex.invalidate(this, id);
      const path = await this.getStoredAbsolutePath(id);
      if (path) {
        noteContentIndex.queueSaved(this, id, path);
      }
    }
  }

  private async operation<T>(operation: object): Promise<T> {
    await this.initialize();
    if (this.disposed || !this.handle) {
      throw new Error('Repository is closed');
    }
    return invoke<T>('repository_operation', {
      handle: this.handle,
      operation,
    });
  }

  protected override loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string;
  }> {
    return this.operation({ kind: 'manifest' });
  }
  protected override async saveManifestImpl(
    manifest: VFSManifest,
    revision: string | null,
  ): Promise<string> {
    const result = await this.operation<{ revision: string }>({
      kind: 'save-manifest',
      manifest,
      revision: revision ?? '',
    });
    return result.revision;
  }
  protected override isConflictError(error: unknown): boolean {
    return String(error).includes('Native manifest conflict');
  }
  protected override manifestMaxRetries(): number {
    return 4;
  }
  protected override async loadFileBytes(
    nodeId: VFSNodeId,
  ): Promise<{ bytes: Uint8Array | null; revision: string | null }> {
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file') {
      return { bytes: null, revision: null };
    }
    const result = await this.operation<{
      bytesBase64: string;
      revision: string | null;
    }>({ kind: 'read-file', nodeId });
    const bytes = decode(result.bytesBase64);
    return { bytes: bytes.length ? bytes : null, revision: result.revision };
  }
  private async writeBytes<T>(
    operation: Record<string, unknown>,
    field: 'bytesBase64' | 'updateBase64',
    bytes: Uint8Array,
  ): Promise<T> {
    if (bytes.length <= 8192) {
      return this.operation<T>({ ...operation, [field]: encode(bytes) });
    }
    const transferId = crypto.randomUUID();
    try {
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        await this.operation({
          kind: 'stage-bytes',
          transferId,
          offset,
          bytesBase64: encode(bytes.subarray(offset, offset + 8192)),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return await this.operation<T>({
        kind: 'finish-transfer',
        transferId,
        operation: { ...operation, [field]: '' },
      });
    } catch (error) {
      await this.operation({ kind: 'cancel-transfer', transferId }).catch(
        () => {},
      );
      throw error;
    }
  }

  protected override async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<string | null> {
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file') {
      throw new Error('Repository file is missing');
    }
    const result = await this.writeBytes<{ revision: string }>(
      {
        kind: 'write-file',
        node,
        replace: true,
        overwriteRemote: false,
      },
      'bytesBase64',
      bytes,
    );
    return result.revision;
  }
  protected override async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    await this.operation({
      kind: 'delete-file',
      nodeId,
      fileType: fileType ?? null,
    });
  }
  protected override async onFileSaved(): Promise<void> {}
  override async writeFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<void> {
    await this.saveFileBytes(nodeId, bytes);
  }
  /** Publishes a new file only after its bytes are durable. */
  override createFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    bytes?: Uint8Array,
    options?: CreateFileOptions,
  ): Promise<VFSNodeId> {
    return this.batchManifestWrites(() =>
      super.createFile(name, fileType, parentId, bytes, options),
    );
  }
  override async importFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    source: FileImportSource,
  ): Promise<VFSNodeId> {
    return this.batchManifestWrites(async () => {
      const id = await super.createFile(name, fileType, parentId);
      const node = await this.getNode(id);
      await this.operation({ kind: 'import-file', node, source });
      return id;
    });
  }
  override renameReferences(
    request: RenameReferencesRequest,
  ): Promise<RenameReferencesResult> {
    return this.operation({ kind: 'rename-references', ...request });
  }
  override createFileVersionIfDue(
    nodeId: VFSNodeId,
    options: { force?: boolean } = {},
  ): Promise<FileVersion | null> {
    return this.operation({
      kind: 'create-file-version',
      nodeId,
      force: options.force ?? false,
    });
  }
  override async restoreFileVersion(
    nodeId: VFSNodeId,
    versionId: VFSNodeId,
  ): Promise<void> {
    await this.operation({ kind: 'restore-file-version', nodeId, versionId });
  }
  override getStoredAbsolutePath(nodeId: VFSNodeId): Promise<string | null> {
    return this.operation({ kind: 'path', nodeId });
  }
  override getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.getStoredAbsolutePath(nodeId);
  }
  override async refresh(): Promise<void> {
    await this.initialize();
    await invoke('repository_sync', { handle: this.handle });
  }
  override flushPending(): Promise<void> {
    return this.refresh();
  }
  override async dispose(): Promise<void> {
    this.disposed = true;
    await this.initializing?.catch(() => undefined);
    for (const unlisten of this.unlisteners.splice(0)) {
      unlisten();
    }
    if (this.handle) {
      await invoke('repository_release', { handle: this.handle });
      this.handle = '';
    }
  }

  override loadDocument(nodeId: VFSNodeId): Promise<NativeDocumentSnapshot> {
    return this.pullUpdates(nodeId);
  }
  override async pullUpdates(
    nodeId: VFSNodeId,
    stateVector?: Uint8Array | null,
  ): Promise<NativeDocumentSnapshot> {
    const result = await this.operation<NativeDocument>({
      kind: 'document',
      nodeId,
      stateVectorBase64: stateVector ? encode(stateVector) : null,
    });
    return {
      generation: result.generation,
      update: decode(result.updateBase64),
      stateVector: decode(result.stateVectorBase64),
      revision: result.revision,
    };
  }
  override pushUpdates(
    nodeId: VFSNodeId,
    update: Uint8Array,
    _options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult> {
    return this.persistDocumentUpdate(nodeId, update);
  }
  async persistDocumentUpdate(
    nodeId: string,
    update: Uint8Array,
    generation?: string,
    sourceSession?: string,
  ): Promise<YjsSyncPushResult> {
    const result = await this.writeBytes<NativeDocument>(
      {
        kind: 'update-document',
        nodeId,
        origin: 'local',
        generation: generation ?? null,
        sourceSession: sourceSession ?? null,
      },
      'updateBase64',
      update,
    );
    return {
      accepted: result.accepted ?? true,
      changed: result.changed ?? false,
      update: null,
      remoteUpdate: null,
      stateVector: decode(result.stateVectorBase64),
      revision: result.revision,
    };
  }
  async flushDocument(nodeId: string): Promise<void> {
    await this.operation({ kind: 'checkpoint-document', nodeId });
  }
  async subscribeDocument(
    nodeId: string,
    listener: (change: NativeDocumentChange) => void,
    sessionId: string,
  ): Promise<() => Promise<void>> {
    await this.initialize();
    const unlisten = await listen<DocumentEvent>(
      `repository-document-${sessionId}`,
      ({ payload }) => {
        if (
          payload.repositoryId !== this.repositoryId ||
          payload.nodeId !== nodeId ||
          this.disposed
        ) {
          return;
        }
        listener({
          update: payload.updateBase64 ? decode(payload.updateBase64) : null,
          origin: payload.origin,
          generation: payload.generation,
          replacement: payload.replacement,
        });
      },
    );
    this.unlisteners.push(unlisten);
    try {
      await this.operation({ kind: 'subscribe', nodeId, sessionId });
    } catch (error) {
      unlisten();
      const index = this.unlisteners.indexOf(unlisten);
      if (index !== -1) {
        this.unlisteners.splice(index, 1);
      }
      throw error;
    }
    return async () => {
      const index = this.unlisteners.indexOf(unlisten);
      if (index !== -1) {
        unlisten();
        this.unlisteners.splice(index, 1);
      }
      if (!this.disposed) {
        await this.operation({ kind: 'unsubscribe', nodeId, sessionId });
      }
    };
  }
}
