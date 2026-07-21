import type { Messages } from '@/lib/i18n';
import type { Repository } from '@/lib/sync';
import type { ImportSource } from './dialog';
import { resolveImportRootName } from './import-tree';
import {
  getPathName,
  importWorkspaceJson,
  type ScannedWorkspace,
  scanWorkspaceJson,
} from './workspace-json';

export function createWorkspaceJsonImportSource({
  dirPath,
  repository,
  parentId,
  strings,
}: {
  dirPath: string;
  repository: Repository;
  parentId: string | null;
  strings: Messages;
}): ImportSource {
  let scanned: ScannedWorkspace | null = null;
  let conflictNodeId: string | null = null;
  const rootName = getPathName(dirPath);
  const dialogStrings = strings.library.importDialog;

  return {
    title: dialogStrings.jsonTitle,
    scanningLabel: dialogStrings.jsonScanning,
    emptyLabel: dialogStrings.jsonNoFiles,

    async scan() {
      scanned = await scanWorkspaceJson(dirPath);

      const [folders] = await repository.listDirectory(parentId);
      const conflictFolder = folders.find(
        (folder) => folder.name.toLowerCase() === rootName.toLowerCase(),
      );
      conflictNodeId = conflictFolder?.id ?? null;

      return {
        name: rootName,
        lines: [
          {
            icon: 'note' as const,
            text: dialogStrings.notes(scanned.notes.length),
          },
          {
            icon: 'media' as const,
            text: dialogStrings.media(scanned.media.length),
          },
        ],
        skippedText:
          scanned.skippedFiles > 0
            ? dialogStrings.skippedFiles(scanned.skippedFiles)
            : null,
        isEmpty: scanned.notes.length === 0 && scanned.media.length === 0,
        conflict: conflictNodeId ? { nodeId: conflictNodeId } : null,
      };
    },

    async run({ conflictResolution, onProgress }) {
      if (!scanned) {
        throw new Error('Must scan before importing');
      }

      const resolvedName = await resolveImportRootName({
        repository,
        parentId,
        name: rootName,
        conflictNodeId,
        conflictResolution,
      });

      const result = await importWorkspaceJson({
        repository,
        parentId,
        dirPath,
        rootName: resolvedName,
        scanned,
        onProgress,
      });

      return {
        rootFolderId: result.rootFolderId,
        text: dialogStrings.summary.imported(
          result.notesImported,
          result.mediaImported,
        ),
        skippedText:
          result.skippedFiles > 0
            ? dialogStrings.summary.skipped(result.skippedFiles)
            : null,
      };
    },
  };
}
