import type { NoteEmbedding } from '@myelin/editor/platform/types';
import type { VFSNodeId } from '@myelin/editor/sync/types';
import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
} from '@tauri-apps/plugin-fs';

const INDEX_DIR = 'NoteIndex';
const SUFFIX = '.json';

/**
 * On-disk index artifact for one node. Written by the Rust engine, read here.
 * `text` is the combined output of every provider that indexed the node, and
 * `providers` holds the per-provider entries it was assembled from. The
 * field shape is a cross-language contract (see `src-tauri/src/note_index/store.rs`).
 */
export interface NoteIndexRecord {
  nodeId: VFSNodeId;
  sourceHash: string;
  schemaVersion: number;
  text: string;
  embedding?: NoteEmbedding | null;
  providers: NoteIndexProviderEntry[];
  updatedAt: number;
}

export interface NoteIndexProviderEntry {
  kind: string;
  text: string;
}

function repoDir(repoId: string): string {
  return `${INDEX_DIR}/${repoId}`;
}

function relPath(repoId: string, nodeId: VFSNodeId): string {
  return `${repoDir(repoId)}/${nodeId}${SUFFIX}`;
}

export async function readNodeRecord(
  repoId: string,
  nodeId: VFSNodeId,
): Promise<NoteIndexRecord | null> {
  const rel = relPath(repoId, nodeId);
  if (!(await exists(rel, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  try {
    const json = await readTextFile(rel, { baseDir: BaseDirectory.AppCache });
    return JSON.parse(json) as NoteIndexRecord;
  } catch {
    return null;
  }
}

export async function listIndexedNodeIds(repoId: string): Promise<VFSNodeId[]> {
  const dir = repoDir(repoId);
  if (!(await exists(dir, { baseDir: BaseDirectory.AppCache }))) {
    return [];
  }
  const entries = await readDir(dir, { baseDir: BaseDirectory.AppCache });
  return entries
    .filter((entry) => entry.isFile && entry.name.endsWith(SUFFIX))
    .map((entry) => entry.name.slice(0, -SUFFIX.length) as VFSNodeId);
}
