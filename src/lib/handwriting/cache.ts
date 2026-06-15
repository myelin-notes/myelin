import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import type { VFSNodeId } from '@/lib/sync';

const HANDWRITING_DIR = 'Handwriting';
const SUFFIX = '.json';

/**
 * On-disk handwriting artifact for one node. Written by the Rust handwriting
 * engine, read here. Each line carries the recognized `text` plus the strokes
 * it came from, so canvas search can match handwriting and navigate to it.
 * The field shape is a cross-language contract (see
 * `src-tauri/src/handwriting/store.rs`).
 */
export interface RecognizedPage {
  nodeId: VFSNodeId;
  sourceHash: string;
  schemaVersion: number;
  lines: RecognizedLine[];
  updatedAt: number;
}

export interface RecognizedLine {
  text: string;
  /** `[x, y, w, h]` in canvas coordinates. */
  bbox: [number, number, number, number];
  strokeIds: string[];
  hash: string;
}

function repoDir(repoId: string): string {
  return `${HANDWRITING_DIR}/${repoId}`;
}

function relPath(repoId: string, nodeId: VFSNodeId): string {
  return `${repoDir(repoId)}/${nodeId}${SUFFIX}`;
}

export async function readNodePage(
  repoId: string,
  nodeId: VFSNodeId,
): Promise<RecognizedPage | null> {
  const rel = relPath(repoId, nodeId);
  if (!(await exists(rel, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  try {
    const json = await readTextFile(rel, { baseDir: BaseDirectory.AppCache });
    return JSON.parse(json) as RecognizedPage;
  } catch {
    return null;
  }
}

export async function listRecognizedNodeIds(
  repoId: string,
): Promise<VFSNodeId[]> {
  const dir = repoDir(repoId);
  if (!(await exists(dir, { baseDir: BaseDirectory.AppCache }))) {
    return [];
  }
  const entries = await readDir(dir, { baseDir: BaseDirectory.AppCache });
  return entries
    .filter((entry) => entry.isFile && entry.name.endsWith(SUFFIX))
    .map((entry) => entry.name.slice(0, -SUFFIX.length) as VFSNodeId);
}
