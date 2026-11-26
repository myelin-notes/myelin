import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { TEMPLATE_EXTENSION } from '@/lib/note/templates';
import type { NativeRepository, VFSNodeId } from '@/lib/sync';
import type { NoteJson } from '../export/workspace-json-format';
import { createCanvasFile } from './canvas-file';
import { getPathBasename } from './import-tree';
import { rebuildNote } from './workspace-json';

export function isTemplateFile(file: Pick<File, 'name'>): boolean {
  return file.name.toLowerCase().endsWith(TEMPLATE_EXTENSION);
}

function parseTemplate(raw: string): NoteJson {
  const note = JSON.parse(raw) as NoteJson;
  if (typeof note?.version !== 'number' || !Array.isArray(note.elements)) {
    throw new Error('Malformed template file');
  }
  return note;
}

/** Templates always land in the templates folder, whatever folder the import targeted. */
export async function importTemplateFile({
  file,
  repository,
}: {
  file: File;
  repository: NativeRepository;
}): Promise<VFSNodeId> {
  const note = parseTemplate(await file.text());
  const rootId = await repository.ensureTemplatesRoot();
  const fallback = file.name.slice(0, -TEMPLATE_EXTENSION.length);
  return createCanvasFile({
    repository,
    parentId: rootId,
    title: (typeof note.name === 'string' && note.name.trim()) || fallback,
    label: 'template',
    build: (ydoc) => rebuildNote(ydoc, note),
  });
}

/** Resolves to the templates folder id, or `null` when the picker was cancelled. */
export async function pickAndImportTemplates(
  repository: NativeRepository,
): Promise<VFSNodeId | null> {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Myelin template', extensions: ['myelin-template'] }],
    fileAccessMode: 'copy',
  });
  if (!selected) {
    return null;
  }
  for (const path of Array.isArray(selected) ? selected : [selected]) {
    // Content URIs (Android) carry no file name in the path.
    const name = path.includes('://')
      ? await invoke<string>('import_file_name', { path })
      : getPathBasename(path, path);
    await importTemplateFile({
      file: new File([await readFile(path)], name),
      repository,
    });
  }
  return repository.ensureTemplatesRoot();
}
