import * as scoped from 'tauri-plugin-scoped-storage-api';
import { Logger } from '@myelin/shared/logger';
import type {
  NativeDocumentSnapshot,
  NativeDocumentWriteResult,
} from '@/lib/sync/native-document-target';
import { processDocumentAsync } from '@/lib/sync/repo/document-worker';
import { NativeRepository } from '@/lib/sync/repo/native';
import type { MetadataPatch } from '@/lib/sync/repo/native-operations';
import { noteContentIndex } from '@/lib/sync/repo/note-content-index';
import { extractStoredNoteLinks } from '@/lib/sync/repo/note-link-index';
import {
  computeRevision,
  createDocFromBytes,
  createEmptyManifest,
  ensureVersionHistoryRoot,
  getStoredFileName,
  isFileVersionNode as isConcreteFileVersionNode,
  setStoredNoteLinks,
  toFileVersion,
  VERSION_HISTORY_INTERVAL_MS,
  VERSION_HISTORY_MAX_PER_FILE,
  type VFSManifest,
} from '@/lib/sync/repo/shared';
import type {
  FileImportSource,
  FileType,
  FileVersion,
  RenameReferencesResult,
  RepositoryCapabilities,
  StoredNoteLink,
  VFSFileNode,
  VFSNodeId,
} from '@/lib/sync/repo/types';
import { getRepositoryTestStorage } from './repository-test-utils';

const logger = new Logger('TestRepository');

/** Storage boundary for tests of shared repository behavior; native sync has its own tests. */
export class TestRepository extends NativeRepository {
  readonly kind = 'local-storage';
  readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
    batchedCommit: false,
  };

  constructor(private readonly testStorageRoot = '') {
    super({
      kind: 'local-storage',
      storageRoot: testStorageRoot,
      source: null,
      capabilities: { polling: false, liveSync: false, batchedCommit: false },
    });
  }

  override get nativeRepositoryHandle(): string {
    return this.testStorageRoot;
  }

  override async initialize(): Promise<void> {
    await this.loadMetadataImpl();
  }

  override async refresh(): Promise<void> {}
  override async dispose(): Promise<void> {}

  override async loadDocument(
    nodeId: VFSNodeId,
  ): Promise<NativeDocumentSnapshot> {
    return this.pullUpdates(nodeId);
  }

  override async pullUpdates(
    nodeId: VFSNodeId,
    stateVector?: Uint8Array | null,
  ): Promise<NativeDocumentSnapshot> {
    const { bytes, revision } = await this.loadFileBytes(nodeId);
    const result = await processDocumentAsync({ bytes, stateVector });
    return {
      update: result.update,
      stateVector: result.stateVector,
      revision,
      generation: 'test',
    };
  }

  override async persistDocumentUpdate(
    nodeId: VFSNodeId,
    update: Uint8Array,
  ): Promise<NativeDocumentWriteResult> {
    const { bytes } = await this.loadFileBytes(nodeId);
    const result = await processDocumentAsync({ bytes, update });
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file') {
      throw new Error('Repository file is missing');
    }
    const revision = await this.saveFileBytes(node, result.update!);
    await this.onFileSaved(nodeId, result.links);
    return {
      stateVector: result.stateVector,
      revision,
      accepted: true,
      changed: result.changed,
    };
  }

  override async flushDocument(): Promise<void> {}

  override async subscribeDocument(): Promise<() => Promise<void>> {
    return async () => {};
  }

  override async createFileVersionIfDue(
    nodeId: VFSNodeId,
    options: { force?: boolean } = {},
  ): Promise<FileVersion | null> {
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file' || node.system) {
      return null;
    }

    const bytes = await this.readFileBytes(nodeId);
    if (!bytes) {
      return null;
    }

    const now = Date.now();
    const sourceRevision = await computeRevision(bytes);
    const versions = await this.listFileVersions(nodeId);
    const latest = versions[0];
    if (versions.some((version) => version.sourceRevision === sourceRevision)) {
      return null;
    }
    if (
      !options.force &&
      latest &&
      now - latest.capturedAt < VERSION_HISTORY_INTERVAL_MS
    ) {
      return null;
    }

    const parentId = await this.getOrCreateVersionHistoryRoot();
    const versionId = await this.createFile(
      `${node.name} ${new Date(now).toISOString()}`,
      node.fileType,
      parentId,
      bytes,
      {
        system: {
          kind: 'file-version',
          sourceFileId: node.id,
          sourceFileType: node.fileType,
          sourceName: node.name,
          sourceRevision,
          capturedAt: now,
          byteLength: bytes.byteLength,
        },
      },
    );

    await this.enforceFileVersionLimit(nodeId);

    const versionNode = await this.getNode(versionId);
    return isConcreteFileVersionNode(versionNode)
      ? toFileVersion(versionNode)
      : null;
  }

  override async writeFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<void> {
    const links = await this.extractStoredNoteLinksForBytes(nodeId, bytes);
    await super.writeFileBytes(nodeId, bytes);
    await this.onFileSaved(nodeId, links);
  }

  override async importFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    source: FileImportSource,
  ): Promise<VFSNodeId> {
    const bytes =
      source.kind === 'scoped'
        ? await scoped.readFile(source.folderId, source.path)
        : await getRepositoryTestStorage().readFile(source.path);
    return this.createFile(name, fileType, parentId, bytes);
  }

  private path(name: string): string {
    return this.testStorageRoot ? `${this.testStorageRoot}/${name}` : name;
  }

  protected override async loadMetadataImpl(): Promise<{
    manifest: VFSManifest;
    revision: string;
  }> {
    const storage = getRepositoryTestStorage();
    const manifest = createEmptyManifest();
    const settings = this.path('repository.json');
    if (await storage.exists(settings)) {
      Object.assign(
        manifest,
        JSON.parse(await storage.readTextFile(settings)),
        { version: 3 },
      );
    } else {
      await storage.writeTextFile(
        settings,
        JSON.stringify({
          version: 1,
          colors: manifest.colors,
          tagRegistry: manifest.tagRegistry,
          penPresets: manifest.penPresets,
        }),
      );
    }
    for (const entry of await storage.readDir(this.path('files'))) {
      if (!entry.name.endsWith('.meta.json')) {
        continue;
      }
      const record = JSON.parse(
        await storage.readTextFile(this.path(`files/${entry.name}`)),
      );
      if (record.deleted) {
        continue;
      }
      manifest.nodes[record.node.id] = record.node;
      if (record.links.length) {
        manifest.linksBySource[record.node.id] = record.links;
      }
    }
    return { manifest, revision: '' };
  }

  protected override async saveMetadataImpl(
    patch: MetadataPatch,
  ): Promise<string> {
    const storage = getRepositoryTestStorage();
    for (const { node, links: providedLinks } of patch.nodes) {
      let links = providedLinks;
      if (node.type === 'file' && node.fileType === 'mcanvas' && !node.system) {
        const path = this.path(`files/${getStoredFileName(node)}`);
        if (await storage.exists(path)) {
          const doc = createDocFromBytes(await storage.readFile(path));
          try {
            links = extractStoredNoteLinks(doc);
          } finally {
            doc.destroy();
          }
        }
      }
      await storage.writeTextFile(
        this.path(`files/${node.id}.meta.json`),
        JSON.stringify({ version: 1, node, links }),
      );
    }
    for (const id of patch.deletedNodeIds) {
      await storage.writeTextFile(
        this.path(`files/${id}.meta.json`),
        JSON.stringify({
          version: 1,
          id,
          deleted: true,
          deletionId: crypto.randomUUID(),
        }),
      );
    }
    if (patch.settings) {
      await storage.writeTextFile(
        this.path('repository.json'),
        JSON.stringify({ ...patch.settings, version: 1 }),
      );
    }
    return '';
  }

  protected override async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const { manifest } = await this.loadMetadataImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type !== 'file') {
      return { bytes: null, revision: null };
    }
    const storage = getRepositoryTestStorage();
    const path = this.path(`files/${getStoredFileName(node)}`);
    const bytes = (await storage.exists(path))
      ? await storage.readFile(path)
      : null;
    return {
      bytes: bytes?.length ? bytes : null,
      revision: await computeRevision(bytes),
    };
  }

  protected override async saveFileBytes(
    node: VFSFileNode,
    bytes: Uint8Array,
  ): Promise<string> {
    await getRepositoryTestStorage().writeFile(
      this.path(`files/${getStoredFileName(node)}`),
      bytes,
    );
    return (await computeRevision(bytes)) ?? '';
  }

  protected override async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    const { manifest } = await this.loadMetadataImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type !== 'file' && !fileType) {
      return;
    }
    const path = this.path(
      `files/${getStoredFileName(node?.type === 'file' ? node : { id: nodeId, fileType: fileType! })}`,
    );
    const storage = getRepositoryTestStorage();
    if (await storage.exists(path)) {
      await storage.remove(path);
    }
  }

  override async renameReferences(): Promise<RenameReferencesResult> {
    throw new Error('Reference rewrites require the native repository.');
  }

  override async restoreFileVersion(): Promise<void> {
    throw new Error('Version restores require the native repository.');
  }

  override async getStoredAbsolutePath(
    nodeId: VFSNodeId,
  ): Promise<string | null> {
    const { manifest } = await this.loadMetadataImpl();
    const node = manifest.nodes[nodeId];
    const storage = getRepositoryTestStorage();
    return node?.type === 'file'
      ? storage.join(
          await storage.appDataDir(),
          this.path(`files/${getStoredFileName(node)}`),
        )
      : null;
  }

  override getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.getStoredAbsolutePath(nodeId);
  }

  protected async onFileSaved(
    nodeId: VFSNodeId,
    links?: readonly StoredNoteLink[],
  ): Promise<void> {
    let indexable = false;
    await this.mutateMetadata('Touch file', { nodes: [nodeId] }, (manifest) => {
      const node = manifest.nodes[nodeId];
      if (node && node.type === 'file') {
        node.modifiedAt = Date.now();
        indexable = node.fileType === 'mcanvas' && !node.system;
        // Snapshots are system nodes; their links must not enter the graph.
        if (node.fileType === 'mcanvas' && !node.system && links) {
          setStoredNoteLinks(manifest, nodeId, links);
        }
      }
    });
    if (indexable) {
      noteContentIndex.invalidate(this, nodeId);
      void this.getStoredAbsolutePath(nodeId)
        .then((path) => {
          if (path) {
            noteContentIndex.queueSaved(this, nodeId, path);
          }
        })
        .catch((error) => {
          logger.error('Could not queue note for indexing', error, { nodeId });
        });
    }
  }

  private async extractStoredNoteLinksForBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<StoredNoteLink[] | undefined> {
    const node = await this.getNode(nodeId);
    if (node?.type !== 'file' || node.fileType !== 'mcanvas') {
      return undefined;
    }

    return extractStoredNoteLinks(createDocFromBytes(bytes));
  }

  private async getOrCreateVersionHistoryRoot(): Promise<VFSNodeId> {
    const targets = { nodes: [] as string[] };
    return this.mutateMetadata(
      'Create version history root',
      targets,
      (manifest) => {
        const id = ensureVersionHistoryRoot(manifest, Date.now());
        targets.nodes.push(id);
        return id;
      },
    );
  }

  private async enforceFileVersionLimit(nodeId: VFSNodeId): Promise<void> {
    const versions = await this.listFileVersions(nodeId);
    const expired = versions.slice(VERSION_HISTORY_MAX_PER_FILE);
    for (const version of expired) {
      await this.deleteNode(version.id);
    }
  }
}
