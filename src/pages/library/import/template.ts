import { TEMPLATE_EXTENSION } from '@/lib/note/templates';
import type { NativeRepository, VFSNodeId } from '@/lib/sync';
import type { NoteJson } from '../export/workspace-json-format';
import { createCanvasFile } from './canvas-file';
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
