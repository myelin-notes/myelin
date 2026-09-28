import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import type { NoteSearchDocument, NoteSearchHit } from './note-search-engine';
import { isSystemNode, type VFSManifest } from './shared';
import type {
  NodeSearchResult,
  NoteIndexItem,
  VFSNode,
  VFSNodeId,
} from './types';

export interface NoteIndexStatus {
  active: boolean;
  scanning: boolean;
  loadError: boolean;
  indexed: number;
  total: number;
  failed: number;
  revision: number;
}

const QUIET_MS = 1_200;
const SAVE_COALESCE_MS = 200;
const SAVED_NOTIFY_MS = 50;
const METADATA_BATCH_SIZE = 100;
const logger = new Logger('NoteContentIndex');

export class NoteContentIndex {
  private repoId: string | null = null;
  private source: object | null = null;
  private epoch = 0;
  private worker: Worker | null = null;
  private workerFailed = false;
  private workerRetryAt = 0;
  private requestId = 0;
  private readonly requests = new Map<
    number,
    { resolve: (hits: NoteSearchHit[]) => void; reject: (error: Error) => void }
  >();
  private metadataManifest: VFSManifest | null = null;
  private metadataRevision = -1;
  private metadataPromise: Promise<void> | null = null;
  private readonly metadataDocuments = new Map<VFSNodeId, NoteSearchDocument>();
  private readonly content = new Map<VFSNodeId, string>();
  private readonly known = new Set<VFSNodeId>();
  private readonly completed = new Set<VFSNodeId>();
  private readonly failures = new Set<VFSNodeId>();
  private readonly removed = new Set<VFSNodeId>();
  private readonly queued = new Map<
    VFSNodeId,
    NoteIndexItem & { force: boolean }
  >();
  private readonly savedQueue = new Set<VFSNodeId>();
  private readonly listeners = new Set<() => void>();
  private status: NoteIndexStatus = {
    active: false,
    scanning: false,
    loadError: false,
    indexed: 0,
    total: 0,
    failed: 0,
    revision: 0,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private lastActivity = 0;
  private lastSave = 0;
  private loadItems: (() => Promise<NoteIndexItem[]>) | null = null;
  private forceCandidates = false;
  private scanning = false;
  private loadError = false;

  getStatus = (): NoteIndexStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(
    repoId: string,
    source: object,
    loadItems: () => Promise<NoteIndexItem[]>,
    forceCandidates = false,
  ): void {
    this.stop();
    this.repoId = repoId;
    this.source = source;
    this.loadItems = loadItems;
    this.forceCandidates = forceCandidates;
    this.scanning = true;
    this.loadError = false;
    this.lastActivity = Date.now();
    this.createWorker();
    window.addEventListener('pointermove', this.recordActivity, {
      passive: true,
    });
    window.addEventListener('pointerdown', this.recordActivity, {
      passive: true,
    });
    window.addEventListener('keydown', this.recordActivity);
    this.publishStatus();
    void this.loadCandidates(this.epoch);
  }

  stop(): void {
    this.epoch++;
    this.repoId = null;
    this.source = null;
    this.loadItems = null;
    this.forceCandidates = false;
    this.scanning = false;
    this.loadError = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.timer = null;
    this.notifyTimer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.recordActivity);
      window.removeEventListener('pointerdown', this.recordActivity);
      window.removeEventListener('keydown', this.recordActivity);
    }
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.requests.values()) {
      request.reject(new Error('Search index stopped'));
    }
    this.requests.clear();
    this.workerFailed = false;
    this.workerRetryAt = 0;
    this.metadataManifest = null;
    this.metadataRevision = -1;
    this.metadataPromise = null;
    this.metadataDocuments.clear();
    this.content.clear();
    this.known.clear();
    this.completed.clear();
    this.failures.clear();
    this.removed.clear();
    this.queued.clear();
    this.savedQueue.clear();
    this.busy = false;
    this.publishStatus();
  }

  reconcile(source: object): void {
    if (this.repoId && this.loadItems && this.source === source) {
      this.start(this.repoId, source, this.loadItems, true);
    }
  }

  invalidate(source: object, nodeId: VFSNodeId): void {
    if (!this.isSource(source)) {
      return;
    }
    this.lastSave = Date.now();
    this.completed.delete(nodeId);
    this.failures.delete(nodeId);
    this.publishStatus();
  }

  queueSaved(source: object, nodeId: VFSNodeId, path: string): void {
    if (!this.isSource(source)) {
      return;
    }
    this.known.add(nodeId);
    this.removed.delete(nodeId);
    this.queued.set(nodeId, { nodeId, path, force: true });
    this.savedQueue.add(nodeId);
    this.publishStatus();
    this.schedule();
  }

  remove(source: object, nodeId: VFSNodeId): void {
    if (!this.isSource(source)) {
      return;
    }
    const repoId = this.repoId;
    this.known.delete(nodeId);
    this.completed.delete(nodeId);
    this.failures.delete(nodeId);
    this.queued.delete(nodeId);
    this.savedQueue.delete(nodeId);
    this.removed.add(nodeId);
    this.setContent(nodeId, '', true);
    this.publishStatus();
    void invoke('remove_note_text_index', { repoId, nodeId }).catch(() => {});
  }

  async search(
    manifest: VFSManifest,
    metadataRevision: number,
    query: string,
    limit?: number,
  ): Promise<NodeSearchResult[]> {
    const epoch = this.epoch;
    if (this.workerFailed && Date.now() >= this.workerRetryAt) {
      this.createWorker();
      this.metadataManifest = null;
      this.metadataRevision = -1;
      this.publishStatus();
    }
    if (!this.repoId || !this.worker || this.workerFailed) {
      throw new Error('Search worker unavailable');
    }
    await this.syncMetadata(manifest, metadataRevision);
    if (epoch !== this.epoch || !this.worker || this.workerFailed) {
      throw new Error('Search worker unavailable');
    }
    const hits = await new Promise<NoteSearchHit[]>((resolve, reject) => {
      const requestId = ++this.requestId;
      this.requests.set(requestId, { resolve, reject });
      this.worker?.postMessage({ type: 'search', requestId, query, limit });
    });
    return hits.flatMap((hit) => {
      const node = manifest.nodes[hit.id];
      return node && !isSystemNode(node)
        ? [
            {
              node,
              score: hit.score,
              contentSnippet: hit.contentSnippet,
              matchedTerms: hit.matchedTerms,
            },
          ]
        : [];
    });
  }

  isSource(source: object): boolean {
    return this.repoId !== null && this.source === source;
  }

  private readonly recordActivity = () => {
    this.lastActivity = Date.now();
  };

  private createWorker(): void {
    try {
      const worker = new Worker(
        new URL('./note-search.worker.ts', import.meta.url),
        {
          type: 'module',
        },
      );
      this.worker = worker;
      this.workerFailed = false;
      worker.onmessage = (
        event: MessageEvent<{ requestId: number; hits: NoteSearchHit[] }>,
      ) => {
        if (this.worker !== worker) {
          return;
        }
        const request = this.requests.get(event.data.requestId);
        if (!request) {
          return;
        }
        this.requests.delete(event.data.requestId);
        request.resolve(event.data.hits);
      };
      worker.onerror = () => {
        if (this.worker !== worker) {
          return;
        }
        this.workerFailed = true;
        this.workerRetryAt = Date.now() + 5_000;
        worker.terminate();
        this.worker = null;
        for (const request of this.requests.values()) {
          request.reject(new Error('Search worker failed'));
        }
        this.requests.clear();
        this.publishStatus();
      };
    } catch {
      this.workerFailed = true;
      this.workerRetryAt = Date.now() + 5_000;
    }
  }

  private async syncMetadata(
    manifest: VFSManifest,
    revision: number,
  ): Promise<void> {
    if (
      this.metadataManifest === manifest &&
      this.metadataRevision === revision
    ) {
      return this.metadataPromise ?? Promise.resolve();
    }
    if (this.metadataPromise) {
      await this.metadataPromise;
    }
    const initial = this.metadataManifest === null;
    this.metadataManifest = manifest;
    this.metadataRevision = revision;
    const epoch = this.epoch;
    const sync = (async () => {
      const seen = new Set<VFSNodeId>();
      let batch: NoteSearchDocument[] = [];
      let inspected = 0;
      for (const id in manifest.nodes) {
        const node = manifest.nodes[id];
        if (isSystemNode(node)) {
          continue;
        }
        seen.add(id);
        const document = this.toSearchDocument(node);
        const previous = this.metadataDocuments.get(id);
        if (initial || !previous || !sameMetadata(previous, document)) {
          this.metadataDocuments.set(id, document);
          batch.push({
            ...document,
            content: initial ? (this.content.get(id) ?? '') : '',
          });
        }
        if (batch.length === METADATA_BATCH_SIZE) {
          this.worker?.postMessage({ type: 'nodes', nodes: batch });
          batch = [];
        }
        if (++inspected % METADATA_BATCH_SIZE === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (epoch !== this.epoch) {
            return;
          }
        }
      }
      if (batch.length) {
        this.worker?.postMessage({ type: 'nodes', nodes: batch });
      }
      const removed: VFSNodeId[] = [];
      for (const id of this.metadataDocuments.keys()) {
        if (!seen.has(id)) {
          this.metadataDocuments.delete(id);
          removed.push(id);
        }
      }
      if (removed.length) {
        this.worker?.postMessage({ type: 'remove', ids: removed });
      }
    })();
    this.metadataPromise = sync;
    try {
      await sync;
    } finally {
      if (this.metadataPromise === sync) {
        this.metadataPromise = null;
      }
    }
  }

  private toSearchDocument(node: VFSNode): NoteSearchDocument {
    return {
      id: node.id,
      name: node.name,
      tags: node.tags.join(' '),
      kind: node.type,
      fileType: node.type === 'file' ? node.fileType : '',
      content: '',
    };
  }

  private async loadCandidates(epoch: number): Promise<void> {
    try {
      const items = await this.loadItems?.();
      if (epoch !== this.epoch || !items) {
        return;
      }
      this.scanning = false;
      this.loadError = false;
      for (const item of items) {
        if (this.removed.has(item.nodeId)) {
          continue;
        }
        this.known.add(item.nodeId);
        if (!this.queued.has(item.nodeId)) {
          this.queued.set(item.nodeId, {
            ...item,
            force: this.forceCandidates,
          });
        }
      }
      this.publishStatus();
      this.schedule();
    } catch (error) {
      logger.error('Failed to list notes for indexing', error);
      if (epoch === this.epoch) {
        this.scanning = false;
        this.loadError = true;
        this.publishStatus();
      }
    }
  }

  private schedule(): void {
    if (this.timer || this.busy || this.queued.size === 0 || !this.repoId) {
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (Date.now() < this.nextWorkAt()) {
          this.schedule();
        } else {
          void this.processNext();
        }
      },
      Math.max(0, this.nextWorkAt() - Date.now()),
    );
  }

  private nextWorkAt(): number {
    return Math.max(
      this.lastActivity + QUIET_MS,
      this.lastSave + SAVE_COALESCE_MS,
    );
  }

  private async processNext(): Promise<void> {
    const nodeId =
      this.savedQueue.values().next().value ?? this.queued.keys().next().value;
    const item = nodeId ? this.queued.get(nodeId) : undefined;
    if (!nodeId || !item || !this.repoId) {
      return;
    }
    this.queued.delete(nodeId);
    const saved = this.savedQueue.delete(nodeId);
    const repoId = this.repoId;
    const epoch = this.epoch;
    this.busy = true;
    try {
      const text = await invoke<string>('index_note_text', { repoId, ...item });
      await this.waitForQuiet(epoch);
      if (
        epoch === this.epoch &&
        this.known.has(nodeId) &&
        !this.queued.has(nodeId)
      ) {
        this.setContent(nodeId, text, saved);
        this.completed.add(nodeId);
        this.failures.delete(nodeId);
      } else if (epoch === this.epoch && !this.known.has(nodeId)) {
        void invoke('remove_note_text_index', { repoId, nodeId }).catch(
          () => {},
        );
      }
    } catch (error) {
      logger.error('Could not index note', error, { nodeId });
      if (
        epoch === this.epoch &&
        this.known.has(nodeId) &&
        !this.queued.has(nodeId)
      ) {
        this.setContent(nodeId, '');
        this.completed.add(nodeId);
        this.failures.add(nodeId);
      }
    } finally {
      if (epoch === this.epoch) {
        this.busy = false;
        this.publishStatus();
        this.schedule();
      }
    }
  }

  private async waitForQuiet(epoch: number): Promise<void> {
    while (epoch === this.epoch) {
      const remaining = this.lastActivity + QUIET_MS - Date.now();
      if (remaining <= 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  private setContent(nodeId: VFSNodeId, text: string, prompt = false): void {
    if ((this.content.get(nodeId) ?? '') === text) {
      return;
    }
    if (text) {
      this.content.set(nodeId, text);
    } else {
      this.content.delete(nodeId);
    }
    this.worker?.postMessage({ type: 'content', id: nodeId, content: text });
    this.publishStatus(true, prompt);
  }

  private publishStatus(contentChanged = false, prompt = false): void {
    this.status = {
      active: this.repoId !== null,
      scanning: this.scanning,
      loadError: this.loadError || this.workerFailed,
      indexed: this.completed.size - this.failures.size,
      total: this.known.size,
      failed: this.failures.size,
      revision: this.status.revision + (contentChanged ? 1 : 0),
    };
    if (this.notifyTimer && !prompt) {
      return;
    }
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.notifyTimer = setTimeout(
      () => {
        this.notifyTimer = null;
        for (const listener of this.listeners) {
          listener();
        }
      },
      prompt ? SAVED_NOTIFY_MS : 750,
    );
  }
}

function sameMetadata(a: NoteSearchDocument, b: NoteSearchDocument): boolean {
  return (
    a.name === b.name &&
    a.tags === b.tags &&
    a.kind === b.kind &&
    a.fileType === b.fileType
  );
}

export const noteContentIndex = new NoteContentIndex();
