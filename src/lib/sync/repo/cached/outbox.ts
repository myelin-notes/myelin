import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import { createNodeId } from '../shared';
import type { VFSNodeId } from '../types';

export type PendingOp =
  | {
      kind: 'upsert-manifest-node';
      nodeId: string;
      queueRevision: string;
    }
  | {
      kind: 'delete-manifest-node';
      nodeId: string;
      deletedFileIds: VFSNodeId[];
      queueRevision: string;
    }
  | {
      kind: 'push-note';
      nodeId: VFSNodeId;
      baseFileRevision?: string | null;
      replaceFile?: true;
      queueRevision: string;
    }
  | { kind: 'sync-custom-colors'; queueRevision: string };

export interface DeletedSubtree {
  nodeIds: string[];
  fileIds: VFSNodeId[];
}

interface CachedRepositoryOutboxOptions {
  path: string;
  repositoryKind: string;
  onPendingWritesChanged: (count: number) => void;
  onRecoveryError: (error: Error) => void;
}

const logger = new Logger('CachedRepositoryOutbox');

function getParentPath(path: string): string {
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex === -1 ? '' : normalized.slice(0, separatorIndex);
}

function getCorruptOutboxPath(path: string, timestamp: Date): string {
  const parentPath = getParentPath(path);
  const fileName = parentPath ? path.slice(parentPath.length + 1) : path;
  const timestampLabel = timestamp.toISOString().replace(/[^0-9]/g, '');
  const dotIndex = fileName.lastIndexOf('.');
  const corruptFileName =
    dotIndex <= 0
      ? `${fileName}.corrupt.${timestampLabel}`
      : `${fileName.slice(0, dotIndex)}.corrupt.${timestampLabel}${fileName.slice(dotIndex)}`;

  return parentPath ? `${parentPath}/${corruptFileName}` : corruptFileName;
}

function touchPendingOp(op: PendingOp): void {
  op.queueRevision = createNodeId();
}

function withQueueRevision<T extends Omit<PendingOp, 'queueRevision'>>(
  op: T,
): T & { queueRevision: string } {
  return { ...op, queueRevision: createNodeId() };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Cached repository outbox entry must be an object.');
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Cached repository outbox entry missing ${field}.`);
  }
  return value;
}

function optionalStringOrNull(value: unknown): string | null | undefined {
  if (value === undefined || value === null || typeof value === 'string') {
    return value;
  }
  throw new Error(
    'Cached repository outbox entry has invalid baseFileRevision.',
  );
}

function optionalTrue(value: unknown, field: string): true | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === true) {
    return true;
  }
  throw new Error(`Cached repository outbox entry has invalid ${field}.`);
}

function normalizeQueueRevision(value: unknown): {
  queueRevision: string;
  changed: boolean;
} {
  if (typeof value === 'string') {
    return { queueRevision: value, changed: false };
  }
  return { queueRevision: createNodeId(), changed: true };
}

function normalizePendingOp(value: unknown): {
  op: PendingOp;
  changed: boolean;
} {
  const entry = requireRecord(value);
  const kind = requireString(entry.kind, 'kind');
  const { queueRevision, changed } = normalizeQueueRevision(
    entry.queueRevision,
  );

  switch (kind) {
    case 'upsert-manifest-node':
      return {
        op: {
          kind,
          nodeId: requireString(entry.nodeId, 'nodeId'),
          queueRevision,
        },
        changed,
      };
    case 'delete-manifest-node':
      if (
        !Array.isArray(entry.deletedFileIds) ||
        !entry.deletedFileIds.every((nodeId) => typeof nodeId === 'string')
      ) {
        throw new Error(
          'Cached repository outbox delete entry has invalid deletedFileIds.',
        );
      }
      return {
        op: {
          kind,
          nodeId: requireString(entry.nodeId, 'nodeId'),
          deletedFileIds: [...entry.deletedFileIds],
          queueRevision,
        },
        changed,
      };
    case 'push-note': {
      const baseFileRevision = optionalStringOrNull(entry.baseFileRevision);
      const replaceFile = optionalTrue(entry.replaceFile, 'replaceFile');
      return {
        op: {
          kind,
          nodeId: requireString(entry.nodeId, 'nodeId'),
          ...(baseFileRevision !== undefined ? { baseFileRevision } : {}),
          ...(replaceFile ? { replaceFile } : {}),
          queueRevision,
        },
        changed,
      };
    }
    case 'sync-custom-colors':
      return {
        op: {
          kind,
          queueRevision,
        },
        changed,
      };
    default:
      throw new Error(`Unknown cached repository outbox entry: ${kind}.`);
  }
}

function areSameQueueEntry(left: PendingOp, right: PendingOp): boolean {
  return left.queueRevision === right.queueRevision;
}

export function enqueueUpsertManifestNode(
  ops: PendingOp[],
  nodeId: string,
): void {
  const alreadyDeleted = ops.some(
    (op) => op.kind === 'delete-manifest-node' && op.nodeId === nodeId,
  );
  if (alreadyDeleted) {
    return;
  }

  const existing = ops.find(
    (op) => op.kind === 'upsert-manifest-node' && op.nodeId === nodeId,
  );
  if (existing) {
    touchPendingOp(existing);
    return;
  }

  ops.push(withQueueRevision({ kind: 'upsert-manifest-node', nodeId }));
}

export function enqueuePushNote(
  ops: PendingOp[],
  nodeId: VFSNodeId,
  baseFileRevision?: string | null,
  options: { replaceFile?: boolean } = {},
): void {
  const alreadyDeleted = ops.some(
    (op) =>
      op.kind === 'delete-manifest-node' && op.deletedFileIds.includes(nodeId),
  );
  if (alreadyDeleted) {
    return;
  }

  const existing = ops.find(
    (op): op is Extract<PendingOp, { kind: 'push-note' }> =>
      op.kind === 'push-note' && op.nodeId === nodeId,
  );
  if (existing) {
    if (options.replaceFile) {
      existing.replaceFile = true;
      existing.baseFileRevision = undefined;
    }
    touchPendingOp(existing);
    return;
  }

  ops.push(
    withQueueRevision({
      kind: 'push-note',
      nodeId,
      ...(options.replaceFile
        ? { replaceFile: true as const }
        : baseFileRevision !== undefined
          ? { baseFileRevision }
          : {}),
    }),
  );
}

export function enqueueDeleteManifestNode(
  ops: PendingOp[],
  nodeId: string,
  deleted: DeletedSubtree,
): void {
  const deletedNodeIds = new Set(deleted.nodeIds);
  const deletedFileIds = new Set(deleted.fileIds);
  const existingDelete = ops.find(
    (op): op is Extract<PendingOp, { kind: 'delete-manifest-node' }> =>
      op.kind === 'delete-manifest-node' && op.nodeId === nodeId,
  );

  const filtered = ops.filter((op) => {
    switch (op.kind) {
      case 'upsert-manifest-node':
        return !deletedNodeIds.has(op.nodeId);
      case 'delete-manifest-node':
        return !deletedNodeIds.has(op.nodeId);
      case 'push-note':
        return !deletedFileIds.has(op.nodeId);
      default:
        return true;
    }
  });

  filtered.push(
    withQueueRevision({
      kind: 'delete-manifest-node',
      nodeId,
      deletedFileIds: Array.from(
        new Set([
          ...(existingDelete?.deletedFileIds ?? []),
          ...deleted.fileIds,
        ]),
      ),
    }),
  );

  ops.splice(0, ops.length, ...filtered);
}

export function enqueueCustomColorsSync(ops: PendingOp[]): void {
  const existing = ops.find((op) => op.kind === 'sync-custom-colors');
  if (existing) {
    touchPendingOp(existing);
  } else {
    ops.push(withQueueRevision({ kind: 'sync-custom-colors' }));
  }
}

export class CachedRepositoryOutbox {
  private pendingOps: PendingOp[] = [];
  private recoveryErrorValue: Error | null = null;
  private readonly pathValue: string;
  private readonly repositoryKind: string;
  private readonly onPendingWritesChanged: (count: number) => void;
  private readonly onRecoveryError: (error: Error) => void;

  constructor(options: CachedRepositoryOutboxOptions) {
    this.pathValue = options.path;
    this.repositoryKind = options.repositoryKind;
    this.onPendingWritesChanged = options.onPendingWritesChanged;
    this.onRecoveryError = options.onRecoveryError;
  }

  get path(): string {
    return this.pathValue;
  }

  get length(): number {
    return this.pendingOps.length;
  }

  get recoveryError(): Error | null {
    return this.recoveryErrorValue;
  }

  async peekHead(): Promise<{ op: PendingOp; pendingOps: number } | null> {
    await this.load();
    const op = this.pendingOps[0];
    if (!op) {
      return null;
    }
    return {
      op: structuredClone(op),
      pendingOps: this.pendingOps.length,
    };
  }

  snapshotOps(): PendingOp[] {
    return this.pendingOps.map((op) => structuredClone(op));
  }

  async removeHeadIfUnchanged(expected: PendingOp): Promise<boolean> {
    await this.load();
    const currentOp = this.pendingOps[0];
    if (!currentOp || !areSameQueueEntry(currentOp, expected)) {
      this.onPendingWritesChanged(this.pendingOps.length);
      return false;
    }

    this.pendingOps.shift();
    await this.save();
    return true;
  }

  async mutate(
    mutator: (ops: PendingOp[]) => void,
    options: { reload?: boolean } = {},
  ): Promise<void> {
    if (options.reload ?? true) {
      await this.load();
    }

    mutator(this.pendingOps);
    await this.save();
  }

  async load(): Promise<void> {
    await this.ensureDir();

    const path = this.path;
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) {
      this.pendingOps = [];
      this.onPendingWritesChanged(0);
      return;
    }

    const raw = await readTextFile(path, { baseDir: BaseDirectory.AppData });

    let changed = false;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('Cached repository outbox must contain a JSON array.');
      }

      this.pendingOps = parsed.map((entry) => {
        const normalized = normalizePendingOp(entry);
        changed = changed || normalized.changed;
        return normalized.op;
      });
    } catch {
      await this.quarantineCorruptOutbox(path);
      return;
    }

    if (changed) {
      await this.write();
    }

    this.onPendingWritesChanged(this.pendingOps.length);
    logger.debug('Loaded cached repository outbox', {
      repositoryKind: this.repositoryKind,
      outboxPath: path,
      pendingOps: this.pendingOps.length,
    });
  }

  private async save(): Promise<void> {
    await this.ensureDir();
    await this.write();
    this.onPendingWritesChanged(this.pendingOps.length);
    logger.debug('Saved cached repository outbox', {
      repositoryKind: this.repositoryKind,
      outboxPath: this.path,
      pendingOps: this.pendingOps.length,
    });
  }

  private async ensureDir(): Promise<void> {
    const parentPath = getParentPath(this.path);
    if (!parentPath) {
      return;
    }

    if (!(await exists(parentPath, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(parentPath, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
  }

  private async write(): Promise<void> {
    await writeTextFile(this.path, JSON.stringify(this.pendingOps), {
      baseDir: BaseDirectory.AppData,
    });
  }

  private async quarantineCorruptOutbox(path: string): Promise<void> {
    const corruptPath = getCorruptOutboxPath(path, new Date());
    try {
      await rename(path, corruptPath, {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      });
    } catch (renameError) {
      logger.error(
        'Failed to move corrupt cached repository outbox',
        renameError,
        {
          repositoryKind: this.repositoryKind,
          outboxPath: path,
          corruptOutboxPath: corruptPath,
        },
      );
    }

    this.pendingOps = [];
    this.recoveryErrorValue = new Error(
      `Cached repository outbox could not be read and was moved to ${corruptPath}. Local cache sync is paused until recovery.`,
    );
    this.onPendingWritesChanged(0);
    this.onRecoveryError(this.recoveryErrorValue);
    logger.error(
      'Moved corrupt cached repository outbox aside and paused remote cache replacement',
      this.recoveryErrorValue,
      {
        repositoryKind: this.repositoryKind,
        outboxPath: path,
        corruptOutboxPath: corruptPath,
      },
    );
  }
}
