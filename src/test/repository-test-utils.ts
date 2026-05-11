import * as Y from 'yjs';

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
  writeBytes(path: string, bytes: Uint8Array): void;
  readBytes(path: string): Uint8Array | null;
  readJson<T>(path: string): T | null;
}

interface MemoryGoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  bytes: Uint8Array | null;
  headRevisionId: string | null;
  version: number;
  trashed: boolean;
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
  readFileByAppProperty(
    key: string,
    value: string,
  ): Omit<MemoryGoogleDriveFile, 'bytes'> | null;
  readBytes(fileId: string): Uint8Array | null;
}

function createMemoryGitHubApi(): MemoryGitHubApi {
  const files = new Map<string, { sha: string; bytes: Uint8Array }>();
  const nextPutFailures = new Map<string, number>();
  let revision = 0;

  function getPath(url: string): string {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/contents\/(.+)$/);
    if (!match) {
      throw new Error(`Unsupported GitHub contents URL: ${url}`);
    }
    return decodeURIComponent(match[1] ?? '');
  }

  function write(path: string, bytes: Uint8Array): string {
    const sha = `sha-${++revision}`;
    files.set(path, { sha, bytes: new Uint8Array(bytes) });
    return sha;
  }

  return {
    async fetch(url, init) {
      const path = getPath(url);

      if (init.method === 'GET') {
        const entry = files.get(path);
        if (!entry) {
          const prefix = path === '' ? '' : `${path}/`;
          const directoryEntries = [...files.entries()]
            .filter(([filePath]) => filePath.startsWith(prefix))
            .map(([filePath, fileEntry]) => {
              const rest = filePath.slice(prefix.length);
              if (!rest || rest.includes('/')) {
                return null;
              }
              return {
                name: rest,
                path: filePath,
                type: 'file',
                sha: fileEntry.sha,
              };
            })
            .filter(
              (value): value is NonNullable<typeof value> => value !== null,
            );
          if (directoryEntries.length > 0) {
            return createJsonResponse(200, directoryEntries);
          }
          return createTextResponse(404, '{"message":"Not Found"}');
        }
        return createJsonResponse(200, {
          sha: entry.sha,
          content: Buffer.from(entry.bytes).toString('base64'),
        });
      }

      if (init.method === 'PUT') {
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
        return createJsonResponse(200, {
          content: { sha },
        });
      }

      if (init.method === 'DELETE') {
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
        return createJsonResponse(200, {});
      }

      throw new Error(`Unsupported GitHub method: ${init.method}`);
    },
    failNextPut(path, status = 409) {
      nextPutFailures.set(path, status);
    },
    writeBytes(path, bytes) {
      write(path, bytes);
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
  };
}

function createMemoryGoogleDriveApi(): MemoryGoogleDriveApi {
  const files = new Map<string, MemoryGoogleDriveFile>();
  let nextId = 0;
  let nextRevision = 0;

  function createId(): string {
    nextId += 1;
    return `drive-file-${nextId}`;
  }

  function createHeadRevisionId(): string {
    nextRevision += 1;
    return `drive-rev-${nextRevision}`;
  }

  function normalizeBodyBytes(body: BodyInit | null | undefined): Uint8Array {
    if (!body) {
      return new Uint8Array();
    }
    if (typeof body === 'string') {
      return new TextEncoder().encode(body);
    }
    if (body instanceof Uint8Array) {
      return new Uint8Array(body);
    }
    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(
        body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      );
    }
    throw new Error(`Unsupported Google Drive request body: ${typeof body}`);
  }

  function listFiles(query: string): MemoryGoogleDriveFile[] {
    const parentMatch = /'([^']+)' in parents/.exec(query);
    const mimeTypeMatch = /mimeType = '([^']+)'/.exec(query);
    const nameMatch = /name = '([^']+)'/.exec(query);
    const appPropertyMatches = [
      ...query.matchAll(
        /appProperties has \{ key='([^']+)' and value='([^']+)' \}/g,
      ),
    ];
    const requireNotTrashed = query.includes('trashed = false');

    return [...files.values()].filter((file) => {
      if (requireNotTrashed && file.trashed) {
        return false;
      }
      if (parentMatch && !file.parents.includes(parentMatch[1] ?? '')) {
        return false;
      }
      if (mimeTypeMatch && file.mimeType !== (mimeTypeMatch[1] ?? '')) {
        return false;
      }
      if (nameMatch && file.name !== (nameMatch[1] ?? '')) {
        return false;
      }
      for (const appPropertyMatch of appPropertyMatches) {
        const [, key, value] = appPropertyMatch;
        if (file.appProperties[key ?? ''] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  function metadataFor(file: MemoryGoogleDriveFile) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      parents: [...file.parents],
      appProperties: { ...file.appProperties },
      headRevisionId: file.headRevisionId,
      trashed: file.trashed,
      version: String(file.version),
    };
  }

  return {
    async fetch(url, init) {
      const parsed = new URL(url);
      const isDriveHost = parsed.hostname === 'www.googleapis.com';
      if (!isDriveHost) {
        throw new Error(`Unsupported Google Drive URL: ${url}`);
      }

      const pathMatch = parsed.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      const uploadMatch = parsed.pathname.match(
        /^\/upload\/drive\/v3\/files\/([^/]+)$/,
      );

      if (parsed.pathname === '/drive/v3/files' && init.method === 'GET') {
        const query = parsed.searchParams.get('q') ?? '';
        return createJsonResponse(200, {
          files: listFiles(query).map(metadataFor),
        });
      }

      if (parsed.pathname === '/drive/v3/files' && init.method === 'POST') {
        const payload = JSON.parse(String(init.body ?? '{}')) as {
          name?: string;
          mimeType?: string;
          parents?: string[];
          appProperties?: Record<string, string>;
        };
        const file: MemoryGoogleDriveFile = {
          id: createId(),
          name: payload.name ?? 'Untitled',
          mimeType: payload.mimeType ?? 'application/octet-stream',
          parents: [...(payload.parents ?? [])],
          appProperties: { ...(payload.appProperties ?? {}) },
          bytes: null,
          headRevisionId: null,
          version: 0,
          trashed: false,
        };
        files.set(file.id, file);
        return createJsonResponse(200, metadataFor(file));
      }

      if (pathMatch && init.method === 'GET') {
        const file = files.get(pathMatch[1] ?? '');
        if (!file || file.trashed) {
          return createTextResponse(404, '{"error":"Not Found"}');
        }
        if (parsed.searchParams.get('alt') === 'media') {
          return createBinaryResponse(200, file.bytes ?? new Uint8Array());
        }
        return createJsonResponse(200, metadataFor(file));
      }

      if (uploadMatch && init.method === 'PATCH') {
        const file = files.get(uploadMatch[1] ?? '');
        if (!file || file.trashed) {
          return createTextResponse(404, '{"error":"Not Found"}');
        }
        file.bytes = normalizeBodyBytes(init.body);
        file.version += 1;
        file.headRevisionId = createHeadRevisionId();
        return createJsonResponse(200, metadataFor(file));
      }

      if (pathMatch && init.method === 'DELETE') {
        const file = files.get(pathMatch[1] ?? '');
        if (!file || file.trashed) {
          return createTextResponse(404, '{"error":"Not Found"}');
        }
        file.trashed = true;
        return createJsonResponse(200, {});
      }

      throw new Error(`Unsupported Google Drive method: ${init.method} ${url}`);
    },
    readFileByAppProperty(key, value) {
      const file =
        [...files.values()].find(
          (entry) => !entry.trashed && entry.appProperties[key] === value,
        ) ?? null;
      if (!file) {
        return null;
      }
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        parents: [...file.parents],
        appProperties: { ...file.appProperties },
        headRevisionId: file.headRevisionId,
        version: file.version,
        trashed: file.trashed,
      };
    },
    readBytes(fileId) {
      const file = files.get(fileId);
      return file?.bytes ? new Uint8Array(file.bytes) : null;
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
