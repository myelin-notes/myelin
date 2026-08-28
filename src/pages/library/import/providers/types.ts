import type { ComponentType } from 'react';
import type { Messages } from '@myelin/editor/i18n';
import type { DialogFilter } from '@tauri-apps/plugin-dialog';
import type { Repository, VFSNodeId } from '@/lib/sync';
import type { ImportJob } from '../dialog';

/**
 * Keys the provider's i18n block (`library.importSources[id]`) and doubles as the
 * `import_type` analytics value, so these strings must stay stable.
 */
export type ImportProviderId =
  | 'files'
  | 'goodnotes_zip'
  | 'onenote'
  | 'obsidian_vault'
  | 'workspace_json';

/**
 * How the user picks the input. `files` is an HTML file input yielding `File`
 * objects; `file` is the native dialog yielding a path the Rust side reads.
 */
export type ImportPicker =
  | { kind: 'files'; accept: string; multiple: boolean }
  | { kind: 'file'; filters: DialogFilter[] }
  | { kind: 'directory' };

export type ImportSelection =
  | { kind: 'files'; files: File[] }
  | { kind: 'file'; path: string }
  | { kind: 'directory'; path: string };

export interface ImportJobContext {
  selection: ImportSelection;
  repository: Repository;
  parentId: VFSNodeId | null;
  strings: Messages;
}

export interface ImportProvider {
  id: ImportProviderId;
  icon: ComponentType<{ className?: string }>;
  picker: ImportPicker;
  /** `selection.kind` always matches `picker.kind`; the runner guarantees it. */
  createJob(context: ImportJobContext): ImportJob;
}

/** Narrows a selection to the modality a provider declared, or throws for a caller bug. */
export function expectFiles(selection: ImportSelection): File[] {
  if (selection.kind !== 'files') {
    throw new Error('Expected a file selection');
  }
  return selection.files;
}

export function expectFilePath(selection: ImportSelection): string {
  if (selection.kind !== 'file') {
    throw new Error('Expected a file path selection');
  }
  return selection.path;
}

export function expectDirectory(selection: ImportSelection): string {
  if (selection.kind !== 'directory') {
    throw new Error('Expected a directory selection');
  }
  return selection.path;
}
