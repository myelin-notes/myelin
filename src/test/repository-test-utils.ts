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

function createJsonResponse(status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return body;
    },
  };
}

function createTextResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(body) as unknown;
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
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  writeTextFile(path: string, text: string): Promise<void>;
  readBinary(path: string): Uint8Array | null;
  readText(path: string): string | null;
}

function createMemoryStorage(root: string = '/app-data'): MemoryStorage {
  const rootPath = normalizePath(root);
  const directories = new Set<string>(['', '/', rootPath]);
  const textFiles = new Map<string, string>();
  const binaryFiles = new Map<string, Uint8Array>();

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
  }

  return {
    appDataDir: async () => rootPath,
    join: async (...segments) => joinPath(...segments),
    exists: async (path) => {
      const resolved = resolve(path);
      return (
        directories.has(resolved) ||
        textFiles.has(resolved) ||
        binaryFiles.has(resolved)
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
        textFiles.delete(resolved);
        binaryFiles.set(resolved, new Uint8Array());
      }
      return {
        async close() {},
      };
    },
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
    writeFile: async (path, bytes) => {
      const resolved = resolve(path);
      ensureParents(resolved);
      textFiles.delete(resolved);
      binaryFiles.set(resolved, new Uint8Array(bytes));
    },
    writeTextFile: async (path, text) => {
      const resolved = resolve(path);
      ensureParents(resolved);
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
      body?: string;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }>;
  failNextPut(path: string, status?: number): void;
  readBytes(path: string): Uint8Array | null;
  readJson<T>(path: string): T | null;
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

        const payload = JSON.parse(init.body ?? '{}') as {
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
        const payload = JSON.parse(init.body ?? '{}') as { sha?: string };
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
    readFile: async (path: string) => currentStorage.readFile(path),
    readTextFile: async (path: string) => currentStorage.readTextFile(path),
    remove: async (
      path: string,
      options?: {
        recursive?: boolean;
      },
    ) => currentStorage.remove(path, { recursive: options?.recursive }),
    removeFile: async (path: string) => currentStorage.remove(path),
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
        body?: string;
      },
    ) => currentGitHubApi.fetch(url, init),
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
