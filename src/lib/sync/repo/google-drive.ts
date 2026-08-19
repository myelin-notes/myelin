/**
 * Google Drive repository backend.
 *
 * Files live in one app-created folder in the user's My Drive, laid out exactly
 * like the GitHub backend: `manifest.json` plus a `files/` directory. The
 * `drive.file` scope only exposes files this app created, so the folder is
 * found by name among the app's own files rather than picked by the user.
 *
 * Conflict handling caveat: Drive has no compare-and-swap write — there is no
 * `If-Match` on `files.update`. `saveManifestImpl` therefore re-reads the
 * manifest's `headRevisionId` immediately before uploading and refuses if it
 * moved, which `BaseRepository` retries against the fresh manifest. That closes
 * the realistic multi-device window (another device wrote minutes ago) but not
 * the sub-round-trip one: two devices writing inside the same round trip still
 * resolve last-writer-wins.
 */
import { fetch } from '@tauri-apps/plugin-http';
import { BaseRepository } from './base';
import { getGoogleDriveToken } from './google-drive-credentials';
import {
  createEmptyManifest,
  FILES_DIR,
  getStoredFileName,
  getStoredFilePath,
  MANIFEST_PATH,
  migrate,
  type RepositorySnapshot,
  type VFSManifest,
} from './shared';
import type {
  FileType,
  RepositoryCapabilities,
  VFSFileNode,
  VFSNodeId,
} from './types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
/** Parent id of My Drive's root. */
const DRIVE_ROOT_ID = 'root';
const ENTRY_FIELDS = 'files(id,name,headRevisionId)';
const MAX_MANIFEST_RETRIES = 4;
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 60_000;
const LIST_PAGE_SIZE = 1000;
const SNAPSHOT_DOWNLOAD_CONCURRENCY = 8;

export class GoogleDriveConflictError extends Error {
  constructor(path: string) {
    super(`Google Drive file "${path}" changed before the write landed.`);
    this.name = 'GoogleDriveConflictError';
  }
}

interface DriveEntry {
  id: string;
  name: string;
  headRevisionId: string | null;
}

interface DriveFileResource {
  id: string;
  name?: string;
  headRevisionId?: string | null;
}

interface DriveListResponse {
  files?: DriveFileResource[];
  nextPageToken?: string | null;
}

interface GoogleDriveRepositoryConfig {
  folderId: string;
  credentialId: string;
}

function toDriveEntry(resource: DriveFileResource): DriveEntry {
  return {
    id: resource.id,
    name: resource.name ?? '',
    // Absent on a metadata-only file that has no content yet.
    headRevisionId: resource.headRevisionId ?? null,
  };
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function dirNameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function baseNameOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Drive reports quota exhaustion as 403 as well as 429, so 403 is retried even
// though it also covers genuine permission failures — those just fail slower.
function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function readRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }
  }
  return Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

interface DriveRequestInit {
  method: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

/**
 * Sends an authenticated Drive request, retrying rate limits and server errors
 * with backoff. Auth headers are rebuilt per attempt so a token refreshed in
 * the meantime is picked up. Returns null only for a 404 the caller opted into.
 */
async function driveRequest(
  credentialId: string,
  label: string,
  url: string,
  init: DriveRequestInit,
): Promise<Response>;
async function driveRequest(
  credentialId: string,
  label: string,
  url: string,
  init: DriveRequestInit,
  options: { allowNotFound: true },
): Promise<Response | null>;
async function driveRequest(
  credentialId: string,
  label: string,
  url: string,
  init: DriveRequestInit,
  options: { allowNotFound?: boolean } = {},
): Promise<Response | null> {
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    const accessToken = await getGoogleDriveToken(credentialId);
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      return response;
    }
    if (response.status === 404 && options.allowNotFound) {
      return null;
    }
    if (
      !isRetryableStatus(response.status) ||
      attempt === MAX_REQUEST_ATTEMPTS - 1
    ) {
      const body = await response.text().catch(() => '<no response body>');
      throw new Error(`${label} (${response.status}): ${body}`);
    }

    await sleep(readRetryDelayMs(response, attempt));
  }

  throw new Error(`${label}: exhausted retries.`);
}

async function findDriveEntry(
  credentialId: string,
  parentId: string,
  name: string,
  mimeType?: string,
): Promise<DriveEntry | null> {
  const clauses = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `name = '${escapeDriveQueryValue(name)}'`,
    'trashed = false',
  ];
  if (mimeType) {
    clauses.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
  }

  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(
    clauses.join(' and '),
  )}&fields=${encodeURIComponent(ENTRY_FIELDS)}&pageSize=1`;
  const response = await driveRequest(
    credentialId,
    'Google Drive lookup failed',
    url,
    { method: 'GET' },
  );
  const payload = (await response.json()) as DriveListResponse;
  const file = payload.files?.[0];
  return file ? toDriveEntry(file) : null;
}

async function listDriveFolder(
  credentialId: string,
  parentId: string,
): Promise<DriveEntry[]> {
  const query = `'${escapeDriveQueryValue(parentId)}' in parents and trashed = false`;
  const entries: DriveEntry[] = [];
  let pageToken: string | null = null;

  do {
    const url =
      `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}` +
      `&fields=${encodeURIComponent(`nextPageToken,${ENTRY_FIELDS}`)}` +
      `&pageSize=${LIST_PAGE_SIZE}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await driveRequest(
      credentialId,
      'Google Drive list failed',
      url,
      { method: 'GET' },
    );
    const payload = (await response.json()) as DriveListResponse;
    for (const file of payload.files ?? []) {
      entries.push(toDriveEntry(file));
    }
    pageToken = payload.nextPageToken ?? null;
  } while (pageToken);

  return entries;
}

async function createDriveFile(
  credentialId: string,
  parentId: string,
  name: string,
  mimeType?: string,
): Promise<string> {
  const response = await driveRequest(
    credentialId,
    'Google Drive create failed',
    `${DRIVE_API_BASE}/files?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        parents: [parentId],
        ...(mimeType ? { mimeType } : {}),
      }),
    },
  );
  const payload = (await response.json()) as DriveFileResource;
  return payload.id;
}

async function uploadDriveFile(
  credentialId: string,
  fileId: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const url =
    `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}` +
    `?uploadType=media&fields=${encodeURIComponent('id,headRevisionId')}`;
  const response = await driveRequest(
    credentialId,
    'Google Drive upload failed',
    url,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    },
  );
  const payload = (await response.json()) as DriveFileResource;
  return payload.headRevisionId ?? null;
}

async function downloadDriveFile(
  credentialId: string,
  fileId: string,
): Promise<Uint8Array | null> {
  const response = await driveRequest(
    credentialId,
    'Google Drive download failed',
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    { method: 'GET' },
    { allowNotFound: true },
  );
  if (!response) {
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function deleteDriveFile(
  credentialId: string,
  fileId: string,
): Promise<void> {
  await driveRequest(
    credentialId,
    'Google Drive delete failed',
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
    { allowNotFound: true },
  );
}

/**
 * Resolves the repository's root folder in My Drive, creating it if this app
 * has not created one by that name yet. Settings calls this to fill in
 * `folderId` before the repository is used.
 */
export async function ensureGoogleDriveFolder(
  credentialId: string,
  folderName: string,
): Promise<string> {
  const name = folderName.trim();
  if (!name) {
    throw new Error('Google Drive folder name cannot be empty.');
  }

  const existing = await findDriveEntry(
    credentialId,
    DRIVE_ROOT_ID,
    name,
    FOLDER_MIME_TYPE,
  );
  return (
    existing?.id ??
    createDriveFile(credentialId, DRIVE_ROOT_ID, name, FOLDER_MIME_TYPE)
  );
}

export class GoogleDriveRepository extends BaseRepository {
  public readonly kind = 'google-drive';
  public readonly capabilities: RepositoryCapabilities = {
    polling: true,
    liveSync: false,
    batchedCommit: false,
  };

  /**
   * Drive ids of directories under the repository root, keyed by relative path.
   * Only this app creates them, so an id, once resolved, stays valid.
   */
  private readonly folderIds = new Map<string, Promise<string>>();

  constructor(private readonly config: GoogleDriveRepositoryConfig) {
    super();
  }

  protected manifestMaxRetries(): number {
    return MAX_MANIFEST_RETRIES;
  }

  protected isConflictError(error: unknown): boolean {
    return error instanceof GoogleDriveConflictError;
  }

  protected async loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    const entry = await this.findEntry(MANIFEST_PATH);
    const bytes = entry ? await this.download(entry.id) : null;
    if (!bytes || bytes.byteLength === 0) {
      const manifest = createEmptyManifest();
      const revision = await this.saveManifestImpl(
        manifest,
        entry?.headRevisionId ?? null,
        'Initialize empty repository',
      );
      return { manifest, revision };
    }

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as VFSManifest;
    migrate(parsed);
    return { manifest: parsed, revision: entry?.headRevisionId ?? null };
  }

  protected async saveManifestImpl(
    manifest: VFSManifest,
    revision: string | null,
    _action: string,
  ): Promise<string | null> {
    const current = await this.findEntry(MANIFEST_PATH);
    if ((current?.headRevisionId ?? null) !== revision) {
      throw new GoogleDriveConflictError(MANIFEST_PATH);
    }

    const target = current ?? (await this.ensureEntry(MANIFEST_PATH));
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    return uploadDriveFile(this.config.credentialId, target.id, bytes);
  }

  protected async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const node = await this.getFileNode(nodeId);
    if (!node) {
      return { bytes: null, revision: null };
    }

    const entry = await this.findEntry(getStoredFilePath(node));
    if (!entry) {
      return { bytes: null, revision: null };
    }

    const bytes = await this.download(entry.id);
    return bytes
      ? { bytes, revision: entry.headRevisionId }
      : { bytes: null, revision: null };
  }

  // `pushUpdates` already compares the caller's base revision against the
  // remote before calling this, so no compare-and-swap is needed here.
  protected async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
    _revision: string | null,
    _message: string,
  ): Promise<string | null> {
    const node = await this.getFileNode(nodeId);
    if (!node) {
      return null;
    }

    const entry = await this.ensureEntry(getStoredFilePath(node));
    return uploadDriveFile(this.config.credentialId, entry.id, bytes);
  }

  protected async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    const node = await this.getFileNode(nodeId, fileType);
    if (!node) {
      return;
    }

    const entry = await this.findEntry(getStoredFilePath(node));
    if (entry) {
      await deleteDriveFile(this.config.credentialId, entry.id);
    }
  }

  /**
   * Overridden because the inherited default resolves each node's path through
   * its own manifest load — one manifest download per file. Drive has no bulk
   * download, so this lists `files/` once and fetches in bounded batches.
   */
  async exportSnapshot(): Promise<RepositorySnapshot> {
    const { manifest } = await this.loadManifestImpl();
    const fileNodes = Object.values(manifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );
    if (fileNodes.length === 0) {
      return { manifest, notes: {} };
    }

    const filesFolderId = await this.findFolderId(FILES_DIR);
    const idsByName = new Map<string, string>();
    if (filesFolderId) {
      for (const entry of await listDriveFolder(
        this.config.credentialId,
        filesFolderId,
      )) {
        idsByName.set(entry.name, entry.id);
      }
    }

    const notes: Record<VFSNodeId, Uint8Array | null> = {};
    for (
      let start = 0;
      start < fileNodes.length;
      start += SNAPSHOT_DOWNLOAD_CONCURRENCY
    ) {
      const batch = fileNodes.slice(
        start,
        start + SNAPSHOT_DOWNLOAD_CONCURRENCY,
      );
      const downloaded = await Promise.all(
        batch.map(async (node) => {
          const fileId = idsByName.get(getStoredFileName(node));
          const bytes = fileId ? await this.download(fileId) : null;
          return [node.id, bytes] as const;
        }),
      );
      for (const [nodeId, bytes] of downloaded) {
        notes[nodeId] = bytes;
      }
    }

    return { manifest, notes };
  }

  private download(fileId: string): Promise<Uint8Array | null> {
    return downloadDriveFile(this.config.credentialId, fileId);
  }

  /**
   * Settings resolves the folder id before the repository is usable, so an
   * empty one means setup is unfinished. Failing here surfaces that as the
   * repository's error instead of a confusing Drive rejection, and the cached
   * wrapper keeps serving local data meanwhile.
   */
  private get rootFolderId(): string {
    if (!this.config.folderId) {
      throw new Error('Google Drive folder is not configured.');
    }
    return this.config.folderId;
  }

  private async getFileNode(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<Pick<VFSFileNode, 'id' | 'fileType'> | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type === 'file') {
      return node;
    }
    return fileType ? { id: nodeId, fileType } : null;
  }

  private async findEntry(path: string): Promise<DriveEntry | null> {
    const parentId = await this.findFolderId(dirNameOf(path));
    if (!parentId) {
      return null;
    }
    return findDriveEntry(this.config.credentialId, parentId, baseNameOf(path));
  }

  /** The entry for `path`, creating the file and its directories if missing. */
  private async ensureEntry(path: string): Promise<DriveEntry> {
    const name = baseNameOf(path);
    const parentId = await this.ensureFolderId(dirNameOf(path));
    const existing = await findDriveEntry(
      this.config.credentialId,
      parentId,
      name,
    );
    if (existing) {
      return existing;
    }

    const id = await createDriveFile(this.config.credentialId, parentId, name);
    return { id, name, headRevisionId: null };
  }

  private async findFolderId(dirPath: string): Promise<string | null> {
    if (dirPath === '') {
      return this.rootFolderId;
    }

    const cached = this.folderIds.get(dirPath);
    if (cached) {
      return cached;
    }

    const parentId = await this.findFolderId(dirNameOf(dirPath));
    if (!parentId) {
      return null;
    }
    const existing = await findDriveEntry(
      this.config.credentialId,
      parentId,
      baseNameOf(dirPath),
      FOLDER_MIME_TYPE,
    );
    if (!existing) {
      return null;
    }

    this.folderIds.set(dirPath, Promise.resolve(existing.id));
    return existing.id;
  }

  private ensureFolderId(dirPath: string): Promise<string> {
    if (dirPath === '') {
      return Promise.resolve(this.rootFolderId);
    }

    const cached = this.folderIds.get(dirPath);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      const parentId = await this.ensureFolderId(dirNameOf(dirPath));
      const name = baseNameOf(dirPath);
      const existing = await findDriveEntry(
        this.config.credentialId,
        parentId,
        name,
        FOLDER_MIME_TYPE,
      );
      return (
        existing?.id ??
        createDriveFile(
          this.config.credentialId,
          parentId,
          name,
          FOLDER_MIME_TYPE,
        )
      );
    })();

    // Cached while in flight so concurrent writes share one folder creation,
    // but a rejection must not stay cached — the next caller has to retry.
    this.folderIds.set(dirPath, pending);
    pending.catch(() => this.folderIds.delete(dirPath));
    return pending;
  }
}
