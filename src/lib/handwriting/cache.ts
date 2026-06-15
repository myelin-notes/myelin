import type { VFSNodeId } from '@/lib/sync';

/**
 * On-disk handwriting artifact for one node. Written by the Rust handwriting
 * engine. Each line carries the recognized `text` plus the strokes it came
 * from, so canvas search can match handwriting and navigate to it. The field
 * shape is a cross-language contract (see `src-tauri/src/handwriting/store.rs`).
 *
 * The reader for these artifacts lands with the search consumer that needs it;
 * this file is just the typed contract until then.
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
