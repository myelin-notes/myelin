import * as Y from 'yjs';
import type { VFSManifest } from './shared';
import type {
  FileType,
  StoredNoteLink,
  VFSNode,
  VFSNodeId,
  VFSSystemMetadata,
} from './types';

const ROOT_KEY = 'manifest';
const NODES_KEY = 'nodes';
const LINKS_KEY = 'linksBySource';

type ManifestArrayValue = string | StoredNoteLink;

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function syncArray<T extends ManifestArrayValue>(
  target: Y.Array<T>,
  previous: readonly T[],
  next: readonly T[],
): void {
  const remaining = next.map((value) => JSON.stringify(value));
  for (let index = previous.length - 1; index >= 0; index -= 1) {
    const key = JSON.stringify(previous[index]);
    const nextIndex = remaining.indexOf(key);
    if (nextIndex === -1) {
      target.delete(index, 1);
    } else {
      remaining.splice(nextIndex, 1);
    }
  }

  const current = target.toArray().map((value) => JSON.stringify(value));
  for (const value of next) {
    const key = JSON.stringify(value);
    const index = current.indexOf(key);
    if (index === -1) {
      target.push([structuredClone(value)]);
    } else {
      current.splice(index, 1);
    }
  }
}

function getOrCreateArray<T extends ManifestArrayValue>(
  parent: Y.Map<unknown>,
  key: string,
): Y.Array<T> {
  const existing = parent.get(key);
  if (existing instanceof Y.Array) {
    return existing as Y.Array<T>;
  }
  const array = new Y.Array<T>();
  parent.set(key, array);
  return array;
}

function getOrCreateMap<T>(parent: Y.Map<unknown>, key: string): Y.Map<T> {
  const existing = parent.get(key);
  if (existing instanceof Y.Map) {
    return existing as Y.Map<T>;
  }
  const map = new Y.Map<T>();
  parent.set(key, map);
  return map;
}

function readNode(value: unknown): VFSNode | null {
  if (!(value instanceof Y.Map)) {
    return null;
  }
  const id = value.get('id');
  const name = value.get('name');
  const type = value.get('type');
  const parentId = value.get('parentId');
  const createdAt = value.get('createdAt');
  const modifiedAt = value.get('modifiedAt');
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    (type !== 'file' && type !== 'folder') ||
    (typeof parentId !== 'string' && parentId !== null) ||
    typeof createdAt !== 'number' ||
    typeof modifiedAt !== 'number'
  ) {
    return null;
  }

  const tags = getOrCreateArray<string>(value, 'tags').toArray();
  const system = value.get('system') as VFSSystemMetadata | undefined;
  const common = {
    id,
    name,
    parentId,
    tags,
    createdAt,
    modifiedAt,
    ...(system ? { system: structuredClone(system) } : {}),
  };
  if (type === 'folder') {
    return {
      ...common,
      type,
      children: getOrCreateArray<string>(value, 'children').toArray(),
    };
  }

  const fileType = value.get('fileType');
  return typeof fileType === 'string'
    ? { ...common, type, fileType: fileType as FileType }
    : null;
}

function syncScalar(
  target: Y.Map<unknown>,
  key: string,
  previous: unknown,
  next: unknown,
): void {
  if (valuesEqual(previous, next)) {
    return;
  }
  if (next === undefined) {
    target.delete(key);
  } else {
    target.set(key, structuredClone(next));
  }
}

function writeNode(
  target: Y.Map<unknown>,
  previous: VFSNode | undefined,
  next: VFSNode,
): void {
  syncScalar(target, 'id', previous?.id, next.id);
  syncScalar(target, 'name', previous?.name, next.name);
  syncScalar(target, 'type', previous?.type, next.type);
  syncScalar(target, 'parentId', previous?.parentId, next.parentId);
  syncScalar(target, 'createdAt', previous?.createdAt, next.createdAt);
  syncScalar(target, 'modifiedAt', previous?.modifiedAt, next.modifiedAt);
  syncScalar(target, 'system', previous?.system, next.system);
  syncArray(
    getOrCreateArray<string>(target, 'tags'),
    previous?.tags ?? [],
    next.tags,
  );

  if (next.type === 'file') {
    syncScalar(
      target,
      'fileType',
      previous?.type === 'file' ? previous.fileType : undefined,
      next.fileType,
    );
    target.delete('children');
  } else {
    target.delete('fileType');
    syncArray(
      getOrCreateArray<string>(target, 'children'),
      previous?.type === 'folder' ? previous.children : [],
      next.children,
    );
  }
}

function normalizeManifest(manifest: VFSManifest): VFSManifest {
  return {
    version: manifest.version,
    children: manifest.children ?? [],
    nodes: manifest.nodes ?? {},
    linksBySource: manifest.linksBySource ?? {},
    customColors: manifest.customColors ?? [],
    tagRegistry: manifest.tagRegistry ?? [],
  };
}

function normalizePlacements(manifest: VFSManifest): void {
  for (const node of Object.values(manifest.nodes)) {
    if (
      node.parentId !== null &&
      (node.parentId === node.id ||
        manifest.nodes[node.parentId]?.type !== 'folder')
    ) {
      node.parentId = null;
    }
  }

  const syncChildren = (
    current: readonly VFSNodeId[],
    parentId: VFSNodeId | null,
  ) => {
    const expected = Object.values(manifest.nodes)
      .filter((node) => node.parentId === parentId)
      .map((node) => node.id);
    return [
      ...current.filter(
        (id, index) => expected.includes(id) && current.indexOf(id) === index,
      ),
      ...expected.filter((id) => !current.includes(id)),
    ];
  };

  manifest.children = syncChildren(manifest.children, null);
  for (const node of Object.values(manifest.nodes)) {
    if (node.type === 'folder') {
      node.children = syncChildren(node.children, node.id);
    }
  }
}

export class ManifestDocument {
  private manifestCache: VFSManifest | null = null;

  private constructor(private readonly doc: Y.Doc) {}

  static fromManifest(manifest: VFSManifest): ManifestDocument {
    const document = new ManifestDocument(new Y.Doc());
    document.replaceManifest(normalizeManifest(manifest));
    return document;
  }

  static fromBytes(bytes: Uint8Array): ManifestDocument {
    if (bytes[0] === 0x7b) {
      const manifest = JSON.parse(
        new TextDecoder().decode(bytes),
      ) as VFSManifest;
      return ManifestDocument.fromManifest(normalizeManifest(manifest));
    }

    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
    return new ManifestDocument(doc);
  }

  getManifest(): VFSManifest {
    if (this.manifestCache) {
      return this.manifestCache;
    }
    const root = this.doc.getMap<unknown>(ROOT_KEY);
    const nodesMap = getOrCreateMap<unknown>(root, NODES_KEY);
    const nodes: Record<VFSNodeId, VFSNode> = {};
    for (const [id, value] of nodesMap.entries()) {
      const node = readNode(value);
      if (node) {
        nodes[id] = node;
      }
    }

    const linksMap = getOrCreateMap<Y.Array<StoredNoteLink>>(root, LINKS_KEY);
    const linksBySource: Record<VFSNodeId, StoredNoteLink[]> = {};
    for (const [sourceId, links] of linksMap.entries()) {
      if (links instanceof Y.Array) {
        linksBySource[sourceId] = links
          .toArray()
          .map((link) => structuredClone(link));
      }
    }

    this.manifestCache = {
      version: (root.get('version') as number | undefined) ?? 1,
      children: getOrCreateArray<string>(root, 'children').toArray(),
      nodes,
      linksBySource,
      customColors: getOrCreateArray<string>(root, 'customColors').toArray(),
      tagRegistry: getOrCreateArray<string>(root, 'tagRegistry').toArray(),
    };
    normalizePlacements(this.manifestCache);
    return this.manifestCache;
  }

  mutate<T>(mutator: (manifest: VFSManifest) => T): T {
    const next = structuredClone(this.getManifest());
    const result = mutator(next);
    this.replaceManifest(next);
    return result;
  }

  replaceManifest(nextManifest: VFSManifest): void {
    const next = normalizeManifest(nextManifest);
    const previous = this.getManifest();
    this.doc.transact(() => {
      const root = this.doc.getMap<unknown>(ROOT_KEY);
      syncScalar(root, 'version', previous.version, next.version);
      syncArray(
        getOrCreateArray<string>(root, 'children'),
        previous.children,
        next.children,
      );
      syncArray(
        getOrCreateArray<string>(root, 'customColors'),
        previous.customColors,
        next.customColors,
      );
      syncArray(
        getOrCreateArray<string>(root, 'tagRegistry'),
        previous.tagRegistry,
        next.tagRegistry,
      );

      const nodes = getOrCreateMap<unknown>(root, NODES_KEY);
      for (const id of Object.keys(previous.nodes)) {
        if (!next.nodes[id]) {
          nodes.delete(id);
        }
      }
      for (const [id, node] of Object.entries(next.nodes)) {
        const existing = nodes.get(id);
        const target =
          existing instanceof Y.Map ? existing : new Y.Map<unknown>();
        if (!(existing instanceof Y.Map)) {
          nodes.set(id, target);
        }
        writeNode(target, previous.nodes[id], node);
      }

      const links = getOrCreateMap<Y.Array<StoredNoteLink>>(root, LINKS_KEY);
      for (const sourceId of Object.keys(previous.linksBySource)) {
        if (!next.linksBySource[sourceId]) {
          links.delete(sourceId);
        }
      }
      for (const [sourceId, nextLinks] of Object.entries(next.linksBySource)) {
        const existing = links.get(sourceId);
        const target =
          existing instanceof Y.Array
            ? existing
            : new Y.Array<StoredNoteLink>();
        if (!(existing instanceof Y.Array)) {
          links.set(sourceId, target);
        }
        syncArray(target, previous.linksBySource[sourceId] ?? [], nextLinks);
      }
    });
    this.manifestCache = next;
  }

  applyUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update);
    this.manifestCache = null;
  }

  encode(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }
}
