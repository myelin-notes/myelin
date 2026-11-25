import { getPlatform } from '@myelin/editor/platform';
import type { NativeRepository, VFSFileNode, VFSNodeId } from '@/lib/sync';
import { noteJson } from '@/pages/library/export/workspace-json';
import { createBlankCanvasFile } from './create';

export const TEMPLATE_EXTENSION = '.myelin-template';

/** Falls back to a blank canvas when `templateId` is null or no longer exists. */
export async function createCanvasFromTemplate(
  repository: NativeRepository,
  name: string,
  parentId: VFSNodeId | null,
  templateId: VFSNodeId | null,
): Promise<VFSNodeId> {
  const bytes = templateId ? await repository.readFileBytes(templateId) : null;
  return bytes
    ? repository.createFile(name, 'mcanvas', parentId, bytes)
    : createBlankCanvasFile(repository, name, parentId);
}

export async function saveAsTemplate(
  repository: NativeRepository,
  canvas: VFSFileNode,
): Promise<void> {
  const bytes = await repository.readFileBytes(canvas.id);
  if (!bytes) {
    throw new Error(`Canvas has no stored content: ${canvas.id}`);
  }
  const rootId = await repository.ensureTemplatesRoot();
  const name = await repository.getUniqueFileName(canvas.name, rootId);
  await repository.createFile(name, 'mcanvas', rootId, bytes);
}

export async function exportTemplate(
  repository: NativeRepository,
  template: VFSFileNode,
): Promise<void> {
  await getPlatform().saveFile({
    suggestedName: `${template.name}${TEMPLATE_EXTENSION}`,
    filter: { name: 'Myelin template', extensions: ['myelin-template'] },
    data: noteJson(repository, template),
  });
}
