import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import type { VFSNodeId } from '@/lib/sync';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown/import';
import { YDocManager } from '@/pages/canvas/ydoc-manager';

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

function createTextResponse(status: number, body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
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
  ): Promise<{ close(): Promise<void> }>;
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
      return {
        async close() {},
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
  failNextPut(path: string, status?: number): void;
  failNextTarball(status: number, retryAfterSeconds: number): void;
  failNextGraphQL(reason: 'network' | 'unknown' | 'head-conflict'): void;
  bumpHeadOidExternally(): string;
  readBytes(path: string): Uint8Array | null;
  readJson<T>(path: string): T | null;
  setTarball(gzippedTarBytes: Uint8Array): void;
  readonly tarballFetchCount: number;
  readonly graphqlCallCount: number;
  readonly putCallCount: number;
  readonly deleteCallCount: number;
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
  const nextPutFailures = new Map<string, number>();
  let revision = 0;
  let headOid = 'oid-0';
  let headOidCounter = 0;
  let tarball: Uint8Array | null = null;
  let tarballFetchCount = 0;
  let graphqlCallCount = 0;
  let putCallCount = 0;
  let deleteCallCount = 0;
  let nextTarballFailure: {
    status: number;
    retryAfterSeconds: number;
  } | null = null;
  const nextGraphqlFailures: Array<'network' | 'unknown' | 'head-conflict'> =
    [];

  function bumpHeadOid(): string {
    headOidCounter += 1;
    headOid = `oid-${headOidCounter}`;
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
    const sha = `sha-${++revision}`;
    files.set(path, { sha, bytes: new Uint8Array(bytes) });
    return sha;
  }

  async function handleGraphQL(init: {
    body?: BodyInit | null;
  }): Promise<ReturnType<typeof createJsonResponse>> {
    graphqlCallCount += 1;
    if (nextGraphqlFailures.length > 0) {
      const reason = nextGraphqlFailures.shift()!;
      if (reason === 'network') {
        return createTextResponse(503, '{"message":"Service Unavailable"}');
      }
      if (reason === 'head-conflict') {
        return createJsonResponse(200, {
          errors: [
            {
              message: `Expected head oid forced-mismatch but got ${headOid}`,
            },
          ],
        });
      }
      return createJsonResponse(200, {
        errors: [{ message: 'Unexpected error' }],
      });
    }

    const body = JSON.parse(String(init.body ?? '{}')) as {
      query?: string;
      variables?: {
        input?: {
          expectedHeadOid?: string;
          fileChanges?: {
            additions?: Array<{ path: string; contents: string }>;
            deletions?: Array<{ path: string }>;
          };
        };
      };
    };

    if (!body.query?.includes('createCommitOnBranch')) {
      return createJsonResponse(200, {
        errors: [{ message: `Unsupported GraphQL operation` }],
      });
    }

    const input = body.variables?.input;
    if (!input) {
      return createJsonResponse(200, {
        errors: [{ message: 'Missing input' }],
      });
    }

    if (input.expectedHeadOid && input.expectedHeadOid !== headOid) {
      return createJsonResponse(200, {
        errors: [
          {
            message: `Expected head oid ${input.expectedHeadOid} but got ${headOid}`,
          },
        ],
      });
    }

    for (const deletion of input.fileChanges?.deletions ?? []) {
      files.delete(deletion.path);
    }
    for (const addition of input.fileChanges?.additions ?? []) {
      const bytes = new Uint8Array(Buffer.from(addition.contents, 'base64'));
      write(addition.path, bytes);
    }

    const newOid = bumpHeadOid();
    return createJsonResponse(200, {
      data: { createCommitOnBranch: { commit: { oid: newOid } } },
    });
  }

  return {
    async fetch(url, init) {
      const parsed = new URL(url);
      if (parsed.pathname === '/graphql') {
        return handleGraphQL(init);
      }
      const branch = getBranchName(url);
      if (branch !== null) {
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

      const path = getContentsPath(url);
      if (path === null) {
        throw new Error(`Unsupported GitHub URL: ${url}`);
      }

      if (init.method === 'GET') {
        const entry = files.get(path);
        if (!entry) {
          return createTextResponse(404, '{"message":"Not Found"}');
        }
        return createJsonResponse(200, {
          sha: entry.sha,
          content: Buffer.from(entry.bytes).toString('base64'),
        });
      }

      if (init.method === 'PUT') {
        putCallCount += 1;
        const forcedStatus = nextPutFailures.get(path);
        if (forcedStatus) {
          nextPutFailures.delete(path);
          return createTextResponse(forcedStatus, '{"message":"Conflict"}');
        }

        const payload = JSON.parse(String(init.body ?? '{}')) as {
          content?: string;
          sha?: string;
        };
        const existing = files.get(path);
        if (existing && payload.sha && payload.sha !== existing.sha) {
          return createTextResponse(409, '{"message":"SHA mismatch"}');
        }
        const bytes = new Uint8Array(
          Buffer.from(payload.content ?? '', 'base64'),
        );
        const sha = write(path, bytes);
        bumpHeadOid();
        return createJsonResponse(200, {
          content: { sha },
        });
      }

      if (init.method === 'DELETE') {
        deleteCallCount += 1;
        const payload = JSON.parse(String(init.body ?? '{}')) as {
          sha?: string;
        };
        const existing = files.get(path);
        if (!existing) {
          return createTextResponse(404, '{"message":"Not Found"}');
        }
        if (payload.sha && payload.sha !== existing.sha) {
          return createTextResponse(409, '{"message":"SHA mismatch"}');
        }
        files.delete(path);
        bumpHeadOid();
        return createJsonResponse(200, {});
      }

      throw new Error(`Unsupported GitHub method: ${init.method}`);
    },
    failNextPut(path, status = 409) {
      nextPutFailures.set(path, status);
    },
    failNextTarball(status, retryAfterSeconds) {
      nextTarballFailure = { status, retryAfterSeconds };
    },
    failNextGraphQL(reason) {
      nextGraphqlFailures.push(reason);
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
    get graphqlCallCount() {
      return graphqlCallCount;
    },
    get putCallCount() {
      return putCallCount;
    },
    get deleteCallCount() {
      return deleteCallCount;
    },
    get headOid() {
      return headOid;
    },
  };
}

let currentStorage = createMemoryStorage();
let currentGitHubApi = createMemoryGitHubApi();
export function resetRepositoryTestDoubles(): void {
  currentStorage = createMemoryStorage();
  currentGitHubApi = createMemoryGitHubApi();
}

export function getRepositoryTestStorage(): MemoryStorage {
  return currentStorage;
}

export function getRepositoryTestGitHubApi(): MemoryGitHubApi {
  return currentGitHubApi;
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
      throw new Error(`Unsupported mock HTTP host: ${host}`);
    },
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
