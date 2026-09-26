import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { VFSNodeId } from '@/lib/sync';

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '' || normalized === '/') {
    return normalized;
  }
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function joinPath(...segments: string[]): string {
  return normalizePath(segments.filter(Boolean).join('/'));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function createJsonResponse(status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async arrayBuffer() {
      return toArrayBuffer(bytes);
    },
    async text() {
      return body;
    },
  };
}

function createTextResponse(
  status: number,
  body: string,
  headers?: Record<string, string>,
) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async json() {
      return JSON.parse(body) as unknown;
    },
    async arrayBuffer() {
      return toArrayBuffer(bytes);
    },
    async text() {
      return body;
    },
  };
}

function createBinaryResponse(status: number, bytes: Uint8Array) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new Error('Binary response cannot be parsed as JSON.');
    },
    async arrayBuffer() {
      return toArrayBuffer(bytes);
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
  };
}

function createRateLimitResponse(status: number, retryAfterSeconds: number) {
  const body = '{"message":"rate limited"}';
  return {
    ok: false,
    status,
    headers: {
      get(name: string): string | null {
        return name.toLowerCase() === 'retry-after'
          ? String(retryAfterSeconds)
          : null;
      },
    },
    async json() {
      return JSON.parse(body) as unknown;
    },
    async arrayBuffer() {
      return toArrayBuffer(new TextEncoder().encode(body));
    },
    async text() {
      return body;
    },
  };
}

export interface MemoryStorage {
  appDataDir(): Promise<string>;
  join(...segments: string[]): Promise<string>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  open(
    path: string,
    options: {
      write?: boolean;
      create?: boolean;
      truncate?: boolean;
    },
  ): Promise<{
    write(data: Uint8Array): Promise<number>;
    close(): Promise<void>;
  }>;
  readDir(path: string): Promise<
    Array<{
      name: string;
      isDirectory: boolean;
      isFile: boolean;
      isSymlink: boolean;
    }>
  >;
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  writeSymlink(path: string): void;
  writeTextFile(path: string, text: string): Promise<void>;
  readBinary(path: string): Uint8Array | null;
  readText(path: string): string | null;
}

function createMemoryStorage(root: string = '/app-data'): MemoryStorage {
  const rootPath = normalizePath(root);
  const directories = new Set<string>(['', '/', rootPath]);
  const textFiles = new Map<string, string>();
  const binaryFiles = new Map<string, Uint8Array>();
  const symlinks = new Set<string>();

  function resolve(path: string): string {
    if (path === '') {
      return rootPath;
    }
    return normalizePath(path.startsWith('/') ? path : `${rootPath}/${path}`);
  }

  function ensureParents(path: string): void {
    const resolved = resolve(path);
    const parts = resolved.split('/');
    let current = resolved.startsWith('/') ? '' : (parts[0] ?? '');
    const startIndex = resolved.startsWith('/') ? 1 : 0;

    for (let index = startIndex; index < parts.length - 1; index++) {
      current = current
        ? joinPath(current, parts[index] ?? '')
        : `/${parts[index] ?? ''}`;
      directories.add(normalizePath(current));
    }
  }

  function removeNested(resolved: string): void {
    const prefix = `${resolved}/`;
    for (const key of [...directories]) {
      if (key === resolved || key.startsWith(prefix)) {
        directories.delete(key);
      }
    }
    for (const key of [...textFiles.keys()]) {
      if (key === resolved || key.startsWith(prefix)) {
        textFiles.delete(key);
      }
    }
    for (const key of [...binaryFiles.keys()]) {
      if (key === resolved || key.startsWith(prefix)) {
        binaryFiles.delete(key);
      }
    }
    for (const key of [...symlinks]) {
      if (key === resolved || key.startsWith(prefix)) {
        symlinks.delete(key);
      }
    }
  }

  function collectDirectEntries(resolved: string) {
    const prefix = resolved === '/' ? '/' : `${resolved}/`;
    const entries = new Map<
      string,
      {
        name: string;
        isDirectory: boolean;
        isFile: boolean;
        isSymlink: boolean;
      }
    >();

    const addEntry = (path: string, kind: 'directory' | 'file' | 'symlink') => {
      if (path === resolved || !path.startsWith(prefix)) {
        return;
      }
      const rest = path.slice(prefix.length);
      if (!rest || rest.includes('/')) {
        return;
      }
      const existing = entries.get(rest) ?? {
        name: rest,
        isDirectory: false,
        isFile: false,
        isSymlink: false,
      };
      existing.isDirectory ||= kind === 'directory';
      existing.isFile ||= kind === 'file';
      existing.isSymlink ||= kind === 'symlink';
      entries.set(rest, existing);
    };

    for (const path of directories) {
      addEntry(path, 'directory');
    }
    for (const path of textFiles.keys()) {
      addEntry(path, 'file');
    }
    for (const path of binaryFiles.keys()) {
      addEntry(path, 'file');
    }
    for (const path of symlinks) {
      addEntry(path, 'symlink');
    }

    return [...entries.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  return {
    appDataDir: async () => rootPath,
    join: async (...segments) => joinPath(...segments),
    exists: async (path) => {
      const resolved = resolve(path);
      return (
        directories.has(resolved) ||
        textFiles.has(resolved) ||
        binaryFiles.has(resolved) ||
        symlinks.has(resolved)
      );
    },
    mkdir: async (path, options) => {
      const resolved = resolve(path);
      if (options?.recursive) {
        ensureParents(resolved);
      }
      directories.add(resolved);
    },
    open: async (path, options) => {
      const resolved = resolve(path);
      ensureParents(resolved);
      if (options.create || options.truncate) {
        symlinks.delete(resolved);
        textFiles.delete(resolved);
        binaryFiles.set(resolved, new Uint8Array());
      }
      const chunks = [binaryFiles.get(resolved) ?? new Uint8Array()];
      return {
        async write(data) {
          chunks.push(new Uint8Array(data));
          return data.byteLength;
        },
        async close() {
          const bytes = new Uint8Array(
            chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
          );
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          binaryFiles.set(resolved, bytes);
        },
      };
    },
    readDir: async (path) => collectDirectEntries(resolve(path)),
    readFile: async (path) => {
      const resolved = resolve(path);
      return new Uint8Array(binaryFiles.get(resolved) ?? []);
    },
    readTextFile: async (path) => {
      const resolved = resolve(path);
      return textFiles.get(resolved) ?? '';
    },
    remove: async (path, options) => {
      const resolved = resolve(path);
      if (options?.recursive || directories.has(resolved)) {
        removeNested(resolved);
        return;
      }
      textFiles.delete(resolved);
      binaryFiles.delete(resolved);
    },
    rename: async (oldPath, newPath) => {
      const oldResolved = resolve(oldPath);
      const newResolved = resolve(newPath);
      ensureParents(newResolved);

      if (textFiles.has(oldResolved)) {
        textFiles.set(newResolved, textFiles.get(oldResolved) ?? '');
        textFiles.delete(oldResolved);
      }
      if (binaryFiles.has(oldResolved)) {
        binaryFiles.set(
          newResolved,
          new Uint8Array(binaryFiles.get(oldResolved) ?? []),
        );
        binaryFiles.delete(oldResolved);
      }
      if (symlinks.has(oldResolved)) {
        symlinks.add(newResolved);
        symlinks.delete(oldResolved);
      }
    },
    writeFile: async (path, bytes) => {
      const resolved = resolve(path);
      ensureParents(resolved);
      symlinks.delete(resolved);
      textFiles.delete(resolved);
      binaryFiles.set(resolved, new Uint8Array(bytes));
    },
    writeSymlink(path) {
      const resolved = resolve(path);
      ensureParents(resolved);
      textFiles.delete(resolved);
      binaryFiles.delete(resolved);
      symlinks.add(resolved);
    },
    writeTextFile: async (path, text) => {
      const resolved = resolve(path);
      ensureParents(resolved);
      symlinks.delete(resolved);
      binaryFiles.delete(resolved);
      textFiles.set(resolved, text);
    },
    readBinary(path) {
      const resolved = resolve(path);
      const bytes = binaryFiles.get(resolved);
      return bytes ? new Uint8Array(bytes) : null;
    },
    readText(path) {
      return textFiles.get(resolve(path)) ?? null;
    },
  };
}

export interface MemoryGitHubApi {
  fetch(
    url: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  }>;
  failNextBranch(status: number, body?: string): void;
  failNextCompare(status: number): void;
  failNextTarball(status: number, retryAfterSeconds: number): void;
  bumpHeadOidExternally(): string;
  applyGitPush(
    additions: Array<{ path: string; contents: Uint8Array }>,
    deletions: Array<{ path: string }>,
    expectedHeadOid?: string,
  ): {
    status: 'pushed' | 'head-conflict';
    commitOid: string | null;
    blobShas: Record<string, string>;
  };
  readBytes(path: string): Uint8Array | null;
  readJson<T>(path: string): T | null;
  setTarball(gzippedTarBytes: Uint8Array): void;
  readonly tarballFetchCount: number;
  readonly headOid: string;
}

function buildTarballFromFiles(
  files: Map<string, { sha: string; bytes: Uint8Array }>,
): Uint8Array {
  const entries: TarEntryInput[] = [];
  for (const [path, entry] of files) {
    entries.push({ path, bytes: entry.bytes });
  }
  return createGzippedTar('myelin-test-abc1234', entries);
}

function createMemoryGitHubApi(): MemoryGitHubApi {
  const files = new Map<string, { sha: string; bytes: Uint8Array }>();
  let revision = 0;
  let headOid = '0'.repeat(40);
  let headOidCounter = 0;
  let tarball: Uint8Array | null = null;
  let tarballFetchCount = 0;
  const commits = new Map<string, { parent: string }>();
  let nextBranchFailure: { status: number; body: string } | null = null;
  let nextCompareFailure: number | null = null;
  let nextTarballFailure: {
    status: number;
    retryAfterSeconds: number;
  } | null = null;

  function bumpHeadOid(): string {
    const parent = headOid;
    headOidCounter += 1;
    headOid = headOidCounter.toString(16).padStart(40, '0');
    commits.set(headOid, { parent });
    return headOid;
  }

  function getContentsPath(url: string): string | null {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/contents\/(.+)$/);
    if (!match) {
      return null;
    }
    return decodeURIComponent(match[1] ?? '');
  }

  function getBranchName(url: string): string | null {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /\/repos\/[^/]+\/[^/]+\/branches\/(.+)$/,
    );
    if (!match) {
      return null;
    }
    return decodeURIComponent(match[1] ?? '');
  }

  function write(path: string, bytes: Uint8Array): string {
    const sha = (++revision).toString(16).padStart(40, '0');
    files.set(path, { sha, bytes: new Uint8Array(bytes) });
    return sha;
  }

  return {
    applyGitPush(additions, deletions, expectedHeadOid) {
      if (expectedHeadOid && expectedHeadOid !== headOid) {
        return { status: 'head-conflict', commitOid: null, blobShas: {} };
      }
      let changed = false;
      for (const deletion of deletions) {
        changed = files.delete(deletion.path) || changed;
      }
      const blobShas: Record<string, string> = {};
      for (const addition of additions) {
        const current = files.get(addition.path);
        if (
          current &&
          current.bytes.byteLength === addition.contents.byteLength &&
          current.bytes.every(
            (byte, index) => byte === addition.contents[index],
          )
        ) {
          blobShas[addition.path] = current.sha;
        } else {
          blobShas[addition.path] = write(addition.path, addition.contents);
          changed = true;
        }
      }
      return {
        status: 'pushed',
        commitOid: changed ? bumpHeadOid() : headOid,
        blobShas,
      };
    },
    async fetch(url, init) {
      const parsed = new URL(url);
      const branch = getBranchName(url);
      if (branch !== null) {
        if (nextBranchFailure !== null) {
          const failure = nextBranchFailure;
          nextBranchFailure = null;
          return createTextResponse(failure.status, failure.body, {
            'x-github-request-id': 'rest-test-id',
          });
        }
        return createJsonResponse(200, { commit: { sha: headOid } });
      }
      if (parsed.pathname.includes('/tarball/')) {
        tarballFetchCount += 1;
        if (nextTarballFailure) {
          const failure = nextTarballFailure;
          nextTarballFailure = null;
          return createRateLimitResponse(
            failure.status,
            failure.retryAfterSeconds,
          );
        }
        const bytes = tarball ?? buildTarballFromFiles(files);
        return createBinaryResponse(200, bytes);
      }

      const compare = parsed.pathname.match(/\/compare\/([^/]+)\.\.\.([^/]+)$/);
      if (compare && init.method === 'GET') {
        if (nextCompareFailure !== null) {
          const status = nextCompareFailure;
          nextCompareFailure = null;
          return createTextResponse(status, '', {
            'x-github-request-id': 'rest-test-id',
          });
        }
        const base = decodeURIComponent(compare[1] ?? '');
        let current = decodeURIComponent(compare[2] ?? '');
        while (commits.has(current)) {
          if (current === base) {
            break;
          }
          current = commits.get(current)?.parent ?? '';
        }
        return createJsonResponse(200, {
          status: current === base ? 'ahead' : 'diverged',
        });
      }

      const blobSha = parsed.pathname.match(/\/git\/blobs\/([^/]+)$/)?.[1];
      if (blobSha) {
        const entry = [...files.values()].find(({ sha }) => sha === blobSha);
        if (!entry) {
          return createTextResponse(404, '{"message":"Not Found"}');
        }
        if (init.headers?.Accept !== 'application/vnd.github.raw+json') {
          return createTextResponse(
            415,
            '{"message":"Unsupported media type"}',
          );
        }
        return createBinaryResponse(200, entry.bytes);
      }

      const path = getContentsPath(url);
      if (path === null) {
        throw new Error(`Unsupported GitHub URL: ${url}`);
      }

      if (init.method === 'GET') {
        const entry = files.get(path);
        if (!entry) {
          return createTextResponse(404, '{"message":"Not Found"}');
        }
        if (entry.bytes.byteLength > 1024 * 1024) {
          if (init.headers?.Accept !== 'application/vnd.github.object+json') {
            return createTextResponse(
              415,
              '{"message":"Unsupported media type"}',
            );
          }
          return createJsonResponse(200, {
            sha: entry.sha,
            size: entry.bytes.byteLength,
            content: '',
            encoding: 'none',
          });
        }
        return createJsonResponse(200, {
          sha: entry.sha,
          content: Buffer.from(entry.bytes).toString('base64'),
        });
      }

      throw new Error(`Unsupported GitHub method: ${init.method}`);
    },
    failNextBranch(status, body = '{"message":"Not Found"}') {
      nextBranchFailure = { status, body };
    },
    failNextCompare(status) {
      nextCompareFailure = status;
    },
    failNextTarball(status, retryAfterSeconds) {
      nextTarballFailure = { status, retryAfterSeconds };
    },
    bumpHeadOidExternally() {
      return bumpHeadOid();
    },
    readBytes(path) {
      const entry = files.get(path);
      return entry ? new Uint8Array(entry.bytes) : null;
    },
    readJson<T>(path: string): T | null {
      const bytes = this.readBytes(path);
      if (!bytes) {
        return null;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    },
    setTarball(gzippedTarBytes) {
      tarball = new Uint8Array(gzippedTarBytes);
    },
    get tarballFetchCount() {
      return tarballFetchCount;
    },
    get headOid() {
      return headOid;
    },
  };
}

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

interface MemoryDriveNode {
  id: string;
  name: string;
  parentId: string;
  mimeType: string | null;
  bytes: Uint8Array | null;
  headRevisionId: string | null;
}

export interface MemoryGoogleDriveApi {
  fetch(
    url: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: BodyInit | null;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
  }>;
  /**
   * A repository read is `list metadata` then `download`, and the pre-write revision check is
   * another `list`, so firing an external write here lands exactly in the window the conflict retry
   * has to cover.
   */
  beforeNextDownload(callback: () => void | Promise<void>): void;
  /** Answers every request with a rate limit, until reset. */
  rateLimitEveryRequest(status: number, retryAfterSeconds: number): void;
  readonly requestCount: number;
  /** Paths are relative to the repository's root folder, e.g. `manifest.json`. */
  readBytes(path: string): Uint8Array | null;
  readJson<T>(path: string): T | null;
  writeBytes(path: string, bytes: Uint8Array): void;
  readonly rootFolderId: string;
  readonly uploadCallCount: number;
  readonly deleteCallCount: number;
}

function unescapeDriveQueryValue(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function matchDriveQueryValue(query: string, pattern: RegExp): string | null {
  const match = pattern.exec(query);
  return match ? unescapeDriveQueryValue(match[1] ?? '') : null;
}

function toDriveBytes(body: BodyInit | null | undefined): Uint8Array {
  if (body instanceof Uint8Array) {
    return new Uint8Array(body);
  }
  return new TextEncoder().encode(String(body ?? ''));
}

function createMemoryGoogleDriveApi(): MemoryGoogleDriveApi {
  const nodes = new Map<string, MemoryDriveNode>();
  let idCounter = 0;
  let revisionCounter = 0;
  let uploadCallCount = 0;
  let deleteCallCount = 0;
  let beforeDownload: (() => void | Promise<void>) | null = null;
  let rateLimit: { status: number; retryAfterSeconds: number } | null = null;
  let requestCount = 0;

  function createNode(
    name: string,
    parentId: string,
    mimeType: string | null,
  ): MemoryDriveNode {
    const node: MemoryDriveNode = {
      id: `drive-${++idCounter}`,
      name,
      parentId,
      mimeType,
      bytes: null,
      headRevisionId: null,
    };
    nodes.set(node.id, node);
    return node;
  }

  const rootFolder = createNode('Myelin', 'root', DRIVE_FOLDER_MIME_TYPE);

  function findChild(
    parentId: string,
    name: string,
    mimeType?: string,
  ): MemoryDriveNode | null {
    for (const node of nodes.values()) {
      if (
        node.parentId === parentId &&
        node.name === name &&
        (mimeType === undefined || node.mimeType === mimeType)
      ) {
        return node;
      }
    }
    return null;
  }

  function resolveNode(path: string, create: boolean): MemoryDriveNode | null {
    const segments = path.split('/');
    let parentId = rootFolder.id;
    for (const segment of segments.slice(0, -1)) {
      const directory =
        findChild(parentId, segment, DRIVE_FOLDER_MIME_TYPE) ??
        (create ? createNode(segment, parentId, DRIVE_FOLDER_MIME_TYPE) : null);
      if (!directory) {
        return null;
      }
      parentId = directory.id;
    }

    const name = segments[segments.length - 1] ?? '';
    return (
      findChild(parentId, name) ??
      (create ? createNode(name, parentId, null) : null)
    );
  }

  function toResource(node: MemoryDriveNode) {
    return {
      id: node.id,
      name: node.name,
      ...(node.headRevisionId ? { headRevisionId: node.headRevisionId } : {}),
    };
  }

  function writeNode(node: MemoryDriveNode, bytes: Uint8Array): void {
    node.bytes = new Uint8Array(bytes);
    node.headRevisionId = `rev-${++revisionCounter}`;
  }

  return {
    async fetch(url, init) {
      requestCount += 1;
      if (rateLimit) {
        return createRateLimitResponse(
          rateLimit.status,
          rateLimit.retryAfterSeconds,
        );
      }

      const parsed = new URL(url);
      const path = parsed.pathname;

      const uploadMatch = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(path);
      if (uploadMatch && init.method === 'PATCH') {
        uploadCallCount += 1;
        const node = nodes.get(decodeURIComponent(uploadMatch[1] ?? ''));
        if (!node) {
          return createTextResponse(404, '{"error":{"message":"Not Found"}}');
        }
        writeNode(node, toDriveBytes(init.body));
        return createJsonResponse(200, toResource(node));
      }

      const fileMatch = /^\/drive\/v3\/files\/(.+)$/.exec(path);
      if (fileMatch) {
        const id = decodeURIComponent(fileMatch[1] ?? '');
        if (init.method === 'GET') {
          // Snapshot before the hook runs: the caller is meant to observe the
          // pre-write content and only then race with the external writer.
          const node = nodes.get(id);
          const bytes = node?.bytes ? new Uint8Array(node.bytes) : null;
          if (beforeDownload) {
            const callback = beforeDownload;
            beforeDownload = null;
            await callback();
          }
          if (bytes === null) {
            return createTextResponse(404, '{"error":{"message":"Not Found"}}');
          }
          return createBinaryResponse(200, bytes);
        }
        if (init.method === 'DELETE') {
          deleteCallCount += 1;
          if (!nodes.delete(id)) {
            return createTextResponse(404, '{"error":{"message":"Not Found"}}');
          }
          return createTextResponse(200, '{}');
        }
      }

      if (path === '/drive/v3/files') {
        if (init.method === 'GET') {
          const query = parsed.searchParams.get('q') ?? '';
          const parentId = matchDriveQueryValue(
            query,
            /'((?:[^'\\]|\\.)*)' in parents/,
          );
          const name = matchDriveQueryValue(
            query,
            /name = '((?:[^'\\]|\\.)*)'/,
          );
          const mimeType = matchDriveQueryValue(
            query,
            /mimeType = '((?:[^'\\]|\\.)*)'/,
          );

          const files = [...nodes.values()]
            .filter(
              (node) =>
                (parentId === null || node.parentId === parentId) &&
                (name === null || node.name === name) &&
                (mimeType === null || node.mimeType === mimeType),
            )
            .map(toResource);
          return createJsonResponse(200, { files });
        }

        if (init.method === 'POST') {
          const payload = JSON.parse(String(init.body ?? '{}')) as {
            name?: string;
            parents?: string[];
            mimeType?: string;
          };
          const node = createNode(
            payload.name ?? '',
            payload.parents?.[0] ?? 'root',
            payload.mimeType ?? null,
          );
          return createJsonResponse(200, { id: node.id });
        }
      }

      throw new Error(
        `Unsupported Google Drive request: ${init.method} ${url}`,
      );
    },
    beforeNextDownload(callback) {
      beforeDownload = callback;
    },
    rateLimitEveryRequest(status, retryAfterSeconds) {
      rateLimit = { status, retryAfterSeconds };
    },
    get requestCount() {
      return requestCount;
    },
    readBytes(path) {
      const node = resolveNode(path, false);
      return node?.bytes ? new Uint8Array(node.bytes) : null;
    },
    readJson<T>(path: string): T | null {
      const bytes = this.readBytes(path);
      if (!bytes) {
        return null;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    },
    writeBytes(path, bytes) {
      const node = resolveNode(path, true);
      if (node) {
        writeNode(node, bytes);
      }
    },
    get rootFolderId() {
      return rootFolder.id;
    },
    get uploadCallCount() {
      return uploadCallCount;
    },
    get deleteCallCount() {
      return deleteCallCount;
    },
  };
}

let currentStorage = createMemoryStorage();
let currentGitHubApi = createMemoryGitHubApi();
let currentGoogleDriveApi = createMemoryGoogleDriveApi();
export function resetRepositoryTestDoubles(): void {
  currentStorage = createMemoryStorage();
  currentGitHubApi = createMemoryGitHubApi();
  currentGoogleDriveApi = createMemoryGoogleDriveApi();
}

export function getRepositoryTestStorage(): MemoryStorage {
  return currentStorage;
}

export function getRepositoryTestGitHubApi(): MemoryGitHubApi {
  return currentGitHubApi;
}

export function getRepositoryTestGoogleDriveApi(): MemoryGoogleDriveApi {
  return currentGoogleDriveApi;
}

export function createPathModule() {
  return {
    appDataDir: async () => currentStorage.appDataDir(),
    appCacheDir: async () => '/app-cache',
    join: async (...segments: string[]) => currentStorage.join(...segments),
  };
}

export function createPluginFsModule() {
  return {
    BaseDirectory: {
      AppData: 'AppData',
      AppCache: 'AppCache',
    },
    exists: async (path: string) => currentStorage.exists(path),
    mkdir: async (
      path: string,
      options?: {
        recursive?: boolean;
      },
    ) => currentStorage.mkdir(path, { recursive: options?.recursive }),
    open: async (
      path: string,
      options: {
        write?: boolean;
        create?: boolean;
        truncate?: boolean;
      },
    ) => currentStorage.open(path, options),
    readDir: async (path: string) => currentStorage.readDir(path),
    readFile: async (path: string) => currentStorage.readFile(path),
    readTextFile: async (path: string) => currentStorage.readTextFile(path),
    remove: async (
      path: string,
      options?: {
        recursive?: boolean;
      },
    ) => currentStorage.remove(path, { recursive: options?.recursive }),
    removeFile: async (path: string) => currentStorage.remove(path),
    rename: async (oldPath: string, newPath: string) =>
      currentStorage.rename(oldPath, newPath),
    writeFile: async (path: string, bytes: Uint8Array) =>
      currentStorage.writeFile(path, bytes),
    writeTextFile: async (path: string, text: string) =>
      currentStorage.writeTextFile(path, text),
  };
}

export function createPluginHttpModule() {
  return {
    fetch: async (
      url: string,
      init: {
        method: string;
        headers?: Record<string, string>;
        body?: BodyInit | null;
      },
    ) => {
      const host = new URL(url).hostname;
      if (host === 'api.github.com') {
        return currentGitHubApi.fetch(url, init);
      }
      if (host === 'www.googleapis.com') {
        return currentGoogleDriveApi.fetch(url, init);
      }
      throw new Error(`Unsupported mock HTTP host: ${host}`);
    },
  };
}

export async function createCanvasNoteState(
  markdown: string,
  resolveNoteLinkId?: (title: string) => Promise<VFSNodeId | null>,
): Promise<{
  update: Uint8Array;
  stateVector: Uint8Array;
}> {
  const ydoc = new YDocManager();
  await addMarkdownPageFrameToYDoc(ydoc, markdown, { resolveNoteLinkId });
  return {
    update: ydoc.encodeState(),
    stateVector: ydoc.encodeStateVector(),
  };
}

export function createNoteState(text: string): {
  update: Uint8Array;
  stateVector: Uint8Array;
} {
  const doc = new Y.Doc();
  doc.getText('content').insert(0, text);
  return {
    update: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
  };
}

export function readNoteText(update: Uint8Array | null): string {
  if (!update) {
    return '';
  }
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc.getText('content').toString();
}

export interface TarEntryInput {
  path: string;
  bytes: Uint8Array;
}

const TAR_BLOCK = 512;

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    target[offset + i] = text.charCodeAt(i);
  }
}

function writeOctal(
  target: Uint8Array,
  offset: number,
  size: number,
  value: number,
): void {
  const text = value.toString(8).padStart(size - 1, '0');
  writeAscii(target, offset, text);
}

function buildTarHeader(path: string, size: number): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK);
  writeAscii(header, 0, path);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.set(new TextEncoder().encode('        '), 148); // checksum placeholder
  header[156] = '0'.charCodeAt(0);
  writeAscii(header, 257, 'ustar');
  header[262] = 0;
  writeAscii(header, 263, '00');

  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    checksum += header[i];
  }
  writeAscii(header, 148, checksum.toString(8).padStart(6, '0'));
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

// Build a gzipped tar with a `{topDir}/` prefix on each entry, matching the
// layout GitHub's tarball endpoint returns.
export function createGzippedTar(
  topDir: string,
  entries: readonly TarEntryInput[],
): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    const fullPath = `${topDir}/${entry.path}`;
    chunks.push(buildTarHeader(fullPath, entry.bytes.byteLength));
    chunks.push(entry.bytes);
    const padding =
      (TAR_BLOCK - (entry.bytes.byteLength % TAR_BLOCK)) % TAR_BLOCK;
    if (padding > 0) {
      chunks.push(new Uint8Array(padding));
    }
  }
  chunks.push(new Uint8Array(TAR_BLOCK * 2));

  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }
  const tar = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Uint8Array(gzipSync(tar));
}
