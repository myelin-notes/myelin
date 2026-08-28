import type { YDocManager } from '@myelin/editor/ydoc-manager';
import { Logger } from '@myelin/shared/logger';
import type { NoteSession, Repository, VFSNodeId } from '@/lib/sync';

const logger = new Logger('CanvasFileImport');

/**
 * Creates one `mcanvas` node, fills it through a session, and saves it. If
 * `build` or the save throws, the node is deleted again so a failed import
 * leaves nothing behind, and the original error is rethrown for the caller to
 * count or surface.
 *
 * Not safe inside `repository.batchManifestWrites` — the rollback deletes.
 */
export async function createCanvasFile({
  repository,
  parentId,
  title,
  label,
  build,
}: {
  repository: Repository;
  parentId: VFSNodeId | null;
  /** Base name; uniquified against `parentId` before the node is created. */
  title: string;
  /** Names the source in log messages, e.g. 'Markdown'. */
  label: string;
  build: (ydoc: YDocManager) => void | Promise<void>;
}): Promise<VFSNodeId> {
  let createdId: VFSNodeId | null = null;
  let session: NoteSession | null = null;

  try {
    const name = await repository.getUniqueFileName(title, parentId);
    createdId = await repository.createFile(name, 'mcanvas', parentId);
    session = await repository.openSession(createdId);
    await build(session.ydoc);
    await session.save();
    await session.close();
    session = null;

    const importedId = createdId;
    createdId = null;
    return importedId;
  } catch (error) {
    logger.error(`Failed to import ${label}`, error, { title, createdId });
    if (session) {
      await session.close().catch(() => {});
    }
    if (createdId) {
      await repository.deleteNode(createdId).catch((deleteError) => {
        logger.error(`Failed to clean up failed ${label} import`, deleteError, {
          createdId,
        });
      });
    }
    throw error;
  }
}
