import type { RepositoryConfig } from '../repo/config';
import type { VFSNodeId } from '../types';

export const LIVE_DISCOVERY_RECORD_TTL_MS = 10 * 60 * 1000;
export const LIVE_DISCOVERY_MAX_RECORDS = 16;

export interface LiveDiscoveryRecordInput {
  recordId: string;
  peerId: string;
  ticket: string;
  ttlMs: number;
}

export interface LiveDiscoveryRecord {
  recordId: string;
  peerId: string;
  ticket: string;
  updatedAt: number;
  expiresAt: number;
}

export interface LiveDiscoveryClient {
  publish(record: LiveDiscoveryRecordInput): Promise<LiveDiscoveryRecord[]>;
  list(): Promise<LiveDiscoveryRecord[]>;
  remove(recordId: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

export function parseLiveDiscoveryRecord(
  value: unknown,
): LiveDiscoveryRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const { recordId, peerId, ticket, updatedAt, expiresAt } = value;
  if (
    !isNonEmptyString(recordId) ||
    !isNonEmptyString(peerId) ||
    !isNonEmptyString(ticket) ||
    !isFiniteTimestamp(updatedAt) ||
    !isFiniteTimestamp(expiresAt)
  ) {
    return null;
  }

  return {
    recordId,
    peerId,
    ticket,
    updatedAt,
    expiresAt,
  };
}

export function parseLiveDiscoveryRecords(
  value: unknown,
): LiveDiscoveryRecord[] {
  const rawRecords = isRecord(value) ? value.records : value;
  if (!Array.isArray(rawRecords)) {
    return [];
  }

  return rawRecords
    .map(parseLiveDiscoveryRecord)
    .filter((record): record is LiveDiscoveryRecord => record !== null);
}

export function getLiveDiscoveryRepositoryKey(
  config: RepositoryConfig,
): string | null {
  switch (config.kind) {
    case 'local':
      return null;
    case 'github':
      return [
        'github',
        config.owner.trim().toLowerCase(),
        config.repo.trim().toLowerCase(),
        (config.branch?.trim() || 'main').toLowerCase(),
      ].join('\0');
    // Keyed on the folder id: it is the account-unique identity of the folder,
    // and unlike its name it survives a rename.
    case 'google-drive':
      return ['google-drive', config.folderId.trim()].join('\0');
  }
}

export async function createLiveDiscoveryRoomId(
  config: RepositoryConfig,
  noteId: VFSNodeId,
): Promise<string | null> {
  const repositoryKey = getLiveDiscoveryRepositoryKey(config);
  if (!repositoryKey) {
    return null;
  }

  return sha256Hex(`${repositoryKey}\0${noteId}`);
}

export function createLiveDiscoveryRecordInput(params: {
  recordId: string;
  peerId: string;
  ticket: string;
  ttlMs?: number;
}): LiveDiscoveryRecordInput {
  return {
    recordId: params.recordId,
    peerId: params.peerId,
    ticket: params.ticket,
    ttlMs: params.ttlMs ?? LIVE_DISCOVERY_RECORD_TTL_MS,
  };
}
