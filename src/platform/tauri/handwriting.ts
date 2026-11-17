import { invoke } from '@tauri-apps/api/core';

export interface HandwritingStroke {
  /** Flat `[x, y, x, y, ...]` in world units. */
  points: number[];
  /** Rendered ink width in world units. */
  width: number;
}

/** One string per block, in order. Rejects on platforms without a recognizer. */
export function recognizeHandwriting(
  blocks: HandwritingStroke[][],
): Promise<string[]> {
  return invoke<string[]>('plugin:handwriting|recognize', { blocks });
}
