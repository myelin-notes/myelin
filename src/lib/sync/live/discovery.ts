import type { VFSNodeId } from '../types';

export const LIVE_PEER_DISCOVERY_RECORD_VERSION = 1;
// Node IDs are stable across address changes, so the TTL only needs to be long
// enough to filter out crashed or uninstalled devices.
export const LIVE_PEER_DISCOVERY_TTL_MS = 300_000;

export interface LivePeerDiscoveryRecord {
  version: typeof LIVE_PEER_DISCOVERY_RECORD_VERSION;
  recordId: string;
  noteId: VFSNodeId;
  peerId: string;
  nodeId: string;
  updatedAt: number;
  expiresAt: number;
}

export interface LiveDiscoveryMailbox {
  publish(record: LivePeerDiscoveryRecord): Promise<void>;
  list(noteId: VFSNodeId): Promise<LivePeerDiscoveryRecord[]>;
  remove(noteId: VFSNodeId, recordId: string): Promise<void>;
  cleanupExpired(
    noteId: VFSNodeId,
    options?: { excludeRecordIds?: readonly string[] },
  ): Promise<void>;
}

export interface LiveDiscoveryCleanupCandidate {
  record: LivePeerDiscoveryRecord;
  remove(): Promise<void>;
}

export interface CleanupExpiredLiveDiscoveryEntriesOptions<Entry> {
  noteId: VFSNodeId;
  entries: readonly Entry[];
  excludeRecordIds?: readonly string[];
  now?: number;
  readCandidate(entry: Entry): Promise<LiveDiscoveryCleanupCandidate | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function createLivePeerDiscoveryRecord(params: {
  recordId: string;
  noteId: VFSNodeId;
  peerId: string;
  nodeId: string;
  now: number;
  ttlMs?: number;
}): LivePeerDiscoveryRecord {
  const ttlMs = params.ttlMs ?? LIVE_PEER_DISCOVERY_TTL_MS;
  return {
    version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
    recordId: params.recordId,
    noteId: params.noteId,
    peerId: params.peerId,
    nodeId: params.nodeId,
    updatedAt: params.now,
    expiresAt: params.now + ttlMs,
  };
}

export function parseLivePeerDiscoveryRecord(
  value: unknown,
): LivePeerDiscoveryRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.version !== LIVE_PEER_DISCOVERY_RECORD_VERSION) {
    return null;
  }

  const { recordId, noteId, peerId, nodeId, updatedAt, expiresAt } = value;
  if (
    typeof recordId !== 'string' ||
    typeof noteId !== 'string' ||
    typeof peerId !== 'string' ||
    typeof nodeId !== 'string' ||
    recordId.trim().length === 0 ||
    noteId.trim().length === 0 ||
    peerId.trim().length === 0 ||
    nodeId.trim().length === 0 ||
    !isFiniteTimestamp(updatedAt) ||
    !isFiniteTimestamp(expiresAt)
  ) {
    return null;
  }

  return {
    version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
    recordId,
    noteId,
    peerId,
    nodeId,
    updatedAt,
    expiresAt,
  };
}

export function isLivePeerDiscoveryRecordFresh(
  record: LivePeerDiscoveryRecord,
  now: number,
): boolean {
  return record.expiresAt > now;
}

export async function cleanupExpiredLiveDiscoveryEntries<Entry>(
  options: CleanupExpiredLiveDiscoveryEntriesOptions<Entry>,
): Promise<void> {
  const excludeRecordIds = new Set(options.excludeRecordIds ?? []);
  const now = options.now ?? Date.now();

  await Promise.all(
    options.entries.map(async (entry) => {
      try {
        const candidate = await options.readCandidate(entry);
        if (
          !candidate ||
          candidate.record.noteId !== options.noteId ||
          excludeRecordIds.has(candidate.record.recordId) ||
          isLivePeerDiscoveryRecordFresh(candidate.record, now)
        ) {
          return;
        }

        await candidate.remove();
      } catch {
        return;
      }
    }),
  );
}
