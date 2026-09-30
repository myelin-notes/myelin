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

let currentStorage = createMemoryStorage();
export function resetRepositoryTestDoubles(): void {
  currentStorage = createMemoryStorage();
}

export function getRepositoryTestStorage(): MemoryStorage {
  return currentStorage;
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
