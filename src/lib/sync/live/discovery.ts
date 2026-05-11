import type { VFSNodeId } from '../types';

export const LIVE_PEER_DISCOVERY_RECORD_VERSION = 1;
export const LIVE_PEER_DISCOVERY_TTL_MS = 30_000;

export interface LivePeerDiscoveryRecord {
  version: typeof LIVE_PEER_DISCOVERY_RECORD_VERSION;
  recordId: string;
  noteId: VFSNodeId;
  peerId: string;
  ticket: string;
  updatedAt: number;
  expiresAt: number;
}

export interface LiveDiscoveryMailbox {
  publish(record: LivePeerDiscoveryRecord): Promise<void>;
  list(noteId: VFSNodeId): Promise<LivePeerDiscoveryRecord[]>;
  remove(noteId: VFSNodeId, recordId: string): Promise<void>;
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
  ticket: string;
  now: number;
  ttlMs?: number;
}): LivePeerDiscoveryRecord {
  const ttlMs = params.ttlMs ?? LIVE_PEER_DISCOVERY_TTL_MS;
  return {
    version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
    recordId: params.recordId,
    noteId: params.noteId,
    peerId: params.peerId,
    ticket: params.ticket,
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

  const { recordId, noteId, peerId, ticket, updatedAt, expiresAt } = value;
  if (
    typeof recordId !== 'string' ||
    typeof noteId !== 'string' ||
    typeof peerId !== 'string' ||
    typeof ticket !== 'string' ||
    recordId.trim().length === 0 ||
    noteId.trim().length === 0 ||
    peerId.trim().length === 0 ||
    ticket.trim().length === 0 ||
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
    ticket,
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
