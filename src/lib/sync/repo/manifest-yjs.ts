import * as Y from 'yjs';
import {
  CURRENT_MANIFEST_VERSION,
  createEmptyManifest,
  migrate,
  type VFSManifest,
} from './shared';
import type { StoredNoteLink, VFSNode, VFSNodeId } from './types';

const MANIFEST_MAP = 'manifest';
const NODES_MAP = 'manifest-nodes';
const LINKS_MAP = 'manifest-links';
const CHILDREN_ARRAY = 'manifest-children';
const CUSTOM_COLORS_ARRAY = 'manifest-custom-colors';
const TAG_REGISTRY_ARRAY = 'manifest-tag-registry';
const STORAGE_FORMAT = 'myelin-yjs-manifest-v1';

interface SerializedManifest {
  format: typeof STORAGE_FORMAT;
  update: string;
}

export interface DecodedManifestDocument {
  doc: Y.Doc;
  needsPersist: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function replaceArray<T>(array: Y.Array<T>, values: readonly T[]): void {
  const current = array.toArray();
  if (valuesEqual(current, values)) {
    return;
  }
  if (current.length > 0) {
    array.delete(0, current.length);
  }
  if (values.length > 0) {
    array.insert(0, [...values]);
  }
}

function syncMap<T>(map: Y.Map<T>, values: Record<string, T>): void {
  for (const key of map.keys()) {
    if (!(key in values)) {
      map.delete(key);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    const next = structuredClone(value);
    if (!valuesEqual(map.get(key), next)) {
      map.set(key, next);
    }
  }
}

function getManifestMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap(MANIFEST_MAP);
}

function getNodesMap(doc: Y.Doc): Y.Map<VFSNode> {
  return doc.getMap(NODES_MAP);
}

function getLinksMap(doc: Y.Doc): Y.Map<StoredNoteLink[]> {
  return doc.getMap(LINKS_MAP);
}

function getChildrenArray(doc: Y.Doc): Y.Array<VFSNodeId> {
  return doc.getArray(CHILDREN_ARRAY);
}

function getCustomColorsArray(doc: Y.Doc): Y.Array<string> {
  return doc.getArray(CUSTOM_COLORS_ARRAY);
}

function getTagRegistryArray(doc: Y.Doc): Y.Array<string> {
  return doc.getArray(TAG_REGISTRY_ARRAY);
}

export function createManifestDocument(
  manifest: VFSManifest = createEmptyManifest(),
): Y.Doc {
  const doc = new Y.Doc();
  writeManifestToDocument(doc, manifest);
  return doc;
}

export function writeManifestToDocument(
  doc: Y.Doc,
  manifest: VFSManifest,
): void {
  doc.transact(() => {
    getManifestMap(doc).set('version', manifest.version);
    replaceArray(getChildrenArray(doc), manifest.children);
    syncMap(getNodesMap(doc), manifest.nodes);
    syncMap(getLinksMap(doc), manifest.linksBySource);
    replaceArray(getCustomColorsArray(doc), manifest.customColors);
    replaceArray(getTagRegistryArray(doc), manifest.tagRegistry);
  });
}

export function readManifestFromDocument(doc: Y.Doc): VFSManifest {
  const version = getManifestMap(doc).get('version');
  const manifest: VFSManifest = {
    version: typeof version === 'number' ? version : CURRENT_MANIFEST_VERSION,
    children: [...getChildrenArray(doc).toArray()],
    nodes: Object.fromEntries(
      Array.from(getNodesMap(doc).entries(), ([id, node]) => [
        id,
        structuredClone(node),
      ]),
    ),
    linksBySource: Object.fromEntries(
      Array.from(getLinksMap(doc).entries(), ([id, links]) => [
        id,
        structuredClone(links),
      ]),
    ),
    customColors: [...getCustomColorsArray(doc).toArray()],
    tagRegistry: [...getTagRegistryArray(doc).toArray()],
  };
  migrate(manifest);
  return manifest;
}

export function encodeManifestDocument(doc: Y.Doc): Uint8Array {
  const serialized: SerializedManifest = {
    format: STORAGE_FORMAT,
    update: bytesToBase64(Y.encodeStateAsUpdate(doc)),
  };
  return new TextEncoder().encode(JSON.stringify(serialized));
}

export function decodeManifestDocument(
  bytes: Uint8Array | null,
): DecodedManifestDocument {
  if (!bytes || bytes.byteLength === 0) {
    return { doc: createManifestDocument(), needsPersist: true };
  }

  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as
    | SerializedManifest
    | VFSManifest;
  if (
    'format' in parsed &&
    parsed.format === STORAGE_FORMAT &&
    typeof parsed.update === 'string'
  ) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, base64ToBytes(parsed.update));
    return { doc, needsPersist: false };
  }

  const legacyManifest = parsed as VFSManifest;
  migrate(legacyManifest);
  return { doc: createManifestDocument(legacyManifest), needsPersist: true };
}
