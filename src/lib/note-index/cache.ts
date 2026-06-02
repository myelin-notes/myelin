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
 * On-disk index artifact for one (node, provider) pair. Written by the Rust
 * engine, read here. A node's directory holds one of these per provider that
 * has indexed it. Field shape is a cross-language contract (see
 * `src-tauri/src/note_index/mod.rs`).
 */
export interface NoteIndexRecord {
  nodeId: VFSNodeId;
  providerKind: string;
  sourceHash: string;
  schemaVersion: number;
  text: string;
  updatedAt: number;
}

function nodeDir(nodeId: VFSNodeId): string {
  return `${INDEX_DIR}/${nodeId}`;
}

/** Combined searchable text from every provider that has indexed this node. */
export async function readNodeText(nodeId: VFSNodeId): Promise<string | null> {
  const dir = nodeDir(nodeId);
  if (!(await exists(dir, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  const entries = await readDir(dir, { baseDir: BaseDirectory.AppCache });
  const texts: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(SUFFIX)) {
      continue;
    }
    try {
      const json = await readTextFile(`${dir}/${entry.name}`, {
        baseDir: BaseDirectory.AppCache,
      });
      const record = JSON.parse(json) as NoteIndexRecord;
      if (record.text) {
        texts.push(record.text);
      }
    } catch {
      // Skip an unreadable or partially-written artifact.
    }
  }
  return texts.length > 0 ? texts.join('\n\n') : null;
}

export async function listIndexedNodeIds(): Promise<VFSNodeId[]> {
  if (!(await exists(INDEX_DIR, { baseDir: BaseDirectory.AppCache }))) {
    return [];
  }
  const entries = await readDir(INDEX_DIR, { baseDir: BaseDirectory.AppCache });
  return entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name as VFSNodeId);
}
