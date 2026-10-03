import * as Y from 'yjs';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { Logger } from '@myelin/shared/logger';
import type { NativeRepository, VFSNodeId } from '@/lib/sync';

const logger = new Logger('CanvasFileImport');

export async function createCanvasFile({
  repository,
  parentId,
  title,
  label,
  build,
}: {
  repository: NativeRepository;
  parentId: VFSNodeId | null;
  /** Base name; uniquified against `parentId` before the node is created. */
  title: string;
  /** Names the source in log messages, e.g. 'Markdown'. */
  label: string;
  build: (ydoc: YDocManager) => void | Promise<void>;
}): Promise<VFSNodeId> {
  const ydoc = new YDocManager();
  try {
    const name = await repository.getUniqueFileName(title, parentId);
    await build(ydoc);
    ydoc.sweepOrphanPageFrameFragments();
    return await repository.createFile(
      name,
      'mcanvas',
      parentId,
      Y.encodeStateAsUpdate(ydoc.doc),
    );
  } catch (error) {
    logger.error(`Failed to import ${label}`, error, { title });
    throw error;
  } finally {
    ydoc.doc.destroy();
  }
}
