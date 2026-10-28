/**
 * Shared contract for the workspace JSON export/import round-trip. Keeping the version, binary
 * marker and base64 codec in one place stops the exporter and importer from drifting apart.
 */

import type { CustomColorTool, PenPreset } from '@/lib/sync';

/** Schema version stamped on each exported note, for future import migration. */
export const NOTE_JSON_VERSION = 1;

// A dotfile so the importer's note scan (and app versions that predate it) skip it.
export const WORKSPACE_JSON_FILE = '.myelin-workspace.json';
export const WORKSPACE_JSON_VERSION = 1;

export const CUSTOM_COLOR_TOOLS = [
  'pen',
  'highlighter',
  'text',
  'folder',
] as const satisfies readonly CustomColorTool[];

export interface NodeMetaJson {
  tags: string[];
  createdAt: number;
  modifiedAt: number;
  /** Folders only. */
  color?: string;
}

/** Workspace state with no home in a note file. Node maps are keyed by export-relative path. */
export interface WorkspaceJson {
  version: number;
  folders: Record<string, NodeMetaJson>;
  /** Non-note files; notes carry their own metadata in {@link NoteJson}. */
  media: Record<string, NodeMetaJson>;
  customColors: Record<CustomColorTool, string[]>;
  penPresets: Omit<PenPreset, 'id'>[];
  tagRegistry: string[];
}

/**
 * Marks a base64-encoded binary value, so the importer can tell binaries from ordinary strings
 * without knowing which element fields are binary.
 */
export const BYTES_MARKER = '__bytes__';

export interface EncodedBytes {
  [BYTES_MARKER]: string;
}

export interface NoteJson {
  version: number;
  name: string;
  fileType: string;
  tags: string[];
  createdAt: number;
  modifiedAt: number;
  /** Each element's Y.Map fields, plus `content` (ProseMirror JSON) on frames. */
  elements: Record<string, unknown>[];
}

const BASE64_CHUNK_SIZE = 0x8000;

export function base64EncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + BASE64_CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64DecodeBytes(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isEncodedBytes(value: unknown): value is EncodedBytes {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[BYTES_MARKER] === 'string'
  );
}
