const DEFAULT_RECORD_TTL_MS = 10 * 60 * 1000;
const MAX_RECORD_TTL_MS = 30 * 60 * 1000;
const MAX_RECORDS_PER_ROOM = 16;
const MAX_REQUEST_BYTES = 16 * 1024;
const RECORD_PREFIX = 'record:';

type DurableObjectId = object;

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface Env {
  LIVE_DISCOVERY_ROOMS: DurableObjectNamespace;
}

interface DiscoveryRecord {
  recordId: string;
  peerId: string;
  ticket: string;
  updatedAt: number;
  expiresAt: number;
}

interface DiscoveryRecordInput {
  recordId?: unknown;
  peerId?: unknown;
  ticket?: unknown;
  ttlMs?: unknown;
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...init.headers,
    },
  });
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
  };
}

function empty(status: number): Response {
  return new Response(null, {
    status,
    headers: corsHeaders(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeId(value: string): boolean {
  return /^[a-zA-Z0-9._-]{1,128}$/.test(value);
}

function isDiscoveryRecord(value: unknown): value is DiscoveryRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.recordId === 'string' &&
    typeof value.peerId === 'string' &&
    typeof value.ticket === 'string' &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  );
}

function parsePath(
  pathname: string,
): { roomId: string; recordId: string | null } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 4 && parts.length !== 5) {
    return null;
  }

  const [version, rooms, roomId, records, recordId] = parts;
  if (
    version !== 'v1' ||
    rooms !== 'rooms' ||
    records !== 'records' ||
    !roomId ||
    !isSafeId(roomId) ||
    (recordId !== undefined && !isSafeId(recordId))
  ) {
    return null;
  }

  return {
    roomId,
    recordId: recordId ?? null,
  };
}

function storageKey(recordId: string): string {
  return `${RECORD_PREFIX}${recordId}`;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_REQUEST_BYTES) {
    throw new Error('Request body is too large.');
  }

  return request.json();
}

function parseRecordInput(value: unknown): DiscoveryRecordInput | null {
  if (!isRecord(value)) {
    return null;
  }

  return value;
}

function createRecord(
  input: DiscoveryRecordInput,
  now: number,
): DiscoveryRecord {
  const recordId = typeof input.recordId === 'string' ? input.recordId : '';
  const peerId = typeof input.peerId === 'string' ? input.peerId : '';
  const ticket = typeof input.ticket === 'string' ? input.ticket : '';
  if (!isSafeId(recordId) || !peerId.trim() || !ticket.trim()) {
    throw new Error('Invalid discovery record.');
  }

  const requestedTtlMs =
    typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs)
      ? input.ttlMs
      : DEFAULT_RECORD_TTL_MS;
  const ttlMs = Math.min(
    Math.max(1_000, Math.floor(requestedTtlMs)),
    MAX_RECORD_TTL_MS,
  );

  return {
    recordId,
    peerId: peerId.trim(),
    ticket: ticket.trim(),
    updatedAt: now,
    expiresAt: now + ttlMs,
  };
}

export class LiveDiscoveryRoom {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return empty(204);
    }

    const parsedPath = parsePath(new URL(request.url).pathname);
    if (!parsedPath) {
      return json({ error: 'Not found.' }, { status: 404 });
    }

    try {
      switch (request.method) {
        case 'GET':
          return json({ records: await this.listFreshRecords() });
        case 'POST':
          return await this.publish(request);
        case 'DELETE':
          return await this.remove(parsedPath.recordId);
        default:
          return json({ error: 'Method not allowed.' }, { status: 405 });
      }
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
  }

  private async publish(request: Request): Promise<Response> {
    const input = parseRecordInput(await readJsonBody(request));
    if (!input) {
      throw new Error('Invalid JSON body.');
    }

    const now = Date.now();
    const record = createRecord(input, now);
    await this.state.storage.put(storageKey(record.recordId), record);
    return json({ records: await this.listFreshRecords(now) });
  }

  private async remove(recordId: string | null): Promise<Response> {
    if (!recordId) {
      return json({ error: 'Record id is required.' }, { status: 404 });
    }

    await this.state.storage.delete(storageKey(recordId));
    return empty(204);
  }

  private async listFreshRecords(now = Date.now()): Promise<DiscoveryRecord[]> {
    const entries = await this.state.storage.list<unknown>({
      prefix: RECORD_PREFIX,
    });
    const records: DiscoveryRecord[] = [];

    await Promise.all(
      Array.from(entries, async ([key, value]) => {
        if (!isDiscoveryRecord(value) || value.expiresAt <= now) {
          await this.state.storage.delete(key);
          return;
        }

        records.push(value);
      }),
    );

    records.sort((a, b) => b.updatedAt - a.updatedAt);
    const extras = records.slice(MAX_RECORDS_PER_ROOM);
    await Promise.all(
      extras.map((record) =>
        this.state.storage.delete(storageKey(record.recordId)),
      ),
    );

    return records.slice(0, MAX_RECORDS_PER_ROOM);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return empty(204);
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    const parsedPath = parsePath(url.pathname);
    if (!parsedPath) {
      return json({ error: 'Not found.' }, { status: 404 });
    }

    const objectId = env.LIVE_DISCOVERY_ROOMS.idFromName(parsedPath.roomId);
    return env.LIVE_DISCOVERY_ROOMS.get(objectId).fetch(request);
  },
};
