import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import type { VFSNodeId } from '@/lib/sync';

const INDEX_DIR = 'NoteIndex';
const SUFFIX = '.json';

/**
 * On-disk index artifact for one node. Written by the Rust engine, read here.
 * `text` is the combined output of every provider that indexed the node. The
 * field shape is a cross-language contract (see `src-tauri/src/note_index/mod.rs`).
 */
export interface NoteIndexRecord {
  nodeId: VFSNodeId;
  sourceHash: string;
  schemaVersion: number;
  text: string;
  updatedAt: number;
}

function relPath(nodeId: VFSNodeId): string {
  return `${INDEX_DIR}/${nodeId}${SUFFIX}`;
}

/** Combined searchable text for a node, or null if it has no index yet. */
export async function readNodeText(nodeId: VFSNodeId): Promise<string | null> {
  const rel = relPath(nodeId);
  if (!(await exists(rel, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  try {
    const json = await readTextFile(rel, { baseDir: BaseDirectory.AppCache });
    const record = JSON.parse(json) as NoteIndexRecord;
    return record.text.length > 0 ? record.text : null;
  } catch {
    return null;
  }
}

export async function listIndexedNodeIds(): Promise<VFSNodeId[]> {
  if (!(await exists(INDEX_DIR, { baseDir: BaseDirectory.AppCache }))) {
    return [];
  }
  const entries = await readDir(INDEX_DIR, { baseDir: BaseDirectory.AppCache });
  return entries
    .filter((entry) => entry.isFile && entry.name.endsWith(SUFFIX))
    .map((entry) => entry.name.slice(0, -SUFFIX.length) as VFSNodeId);
}
