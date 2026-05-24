import type { Messages } from '@/lib/i18n';
import type { Repository } from '@/lib/sync';
import type { ImportSource } from './import-dialog';
import {
  getPathName,
  importObsidianVault,
  type ScannedVault,
  scanVault,
} from './import-obsidian-vault';

export function createObsidianVaultImportSource({
  vaultPath,
  repository,
  parentId,
  strings,
}: {
  vaultPath: string;
  repository: Repository;
  parentId: string | null;
  strings: Messages;
}): ImportSource {
  let scanned: ScannedVault | null = null;
  let conflictNodeId: string | null = null;
  const vaultName = getPathName(vaultPath);

  return {
    title: strings.library.importDialog.title,
    scanningLabel: strings.library.importDialog.scanning,
    emptyLabel: strings.library.importDialog.noFiles,

    async scan() {
      scanned = await scanVault(vaultPath);

      const noteCount = scanned.files.filter(
        (f) => f.kind === 'markdown',
      ).length;
      const mediaCount = scanned.files.filter(
        (f) => f.kind !== 'markdown',
      ).length;

      const [folders] = await repository.listDirectory(parentId);
      const conflictFolder = folders.find(
        (f) => f.name.toLowerCase() === vaultName.toLowerCase(),
      );
      conflictNodeId = conflictFolder?.id ?? null;

      return {
        name: vaultName,
        lines: [
          {
            icon: 'note' as const,
            text: strings.library.importDialog.notes(noteCount),
          },
          {
            icon: 'media' as const,
            text: strings.library.importDialog.media(mediaCount),
          },
        ],
        skippedText:
          scanned.skippedFiles > 0
            ? strings.library.importDialog.skippedFiles(scanned.skippedFiles)
            : null,
        isEmpty: scanned.files.length === 0,
        conflict: conflictNodeId ? { nodeId: conflictNodeId } : null,
      };
    },

    async run({ conflictResolution, signal, onProgress }) {
      if (!scanned) {
        throw new Error('Must scan before importing');
      }

      if (conflictNodeId && conflictResolution === 'replace') {
        await repository.deleteNode(conflictNodeId);
      }

      const result = await importObsidianVault({
        repository,
        parentId,
        vaultPath,
        vaultName:
          conflictNodeId && conflictResolution === 'rename'
            ? undefined
            : vaultName,
        scanned,
        signal,
        onProgress,
      });

      return {
        rootFolderId: result.rootFolderId,
        text: strings.library.importDialog.summary.imported(
          result.notesImported,
          result.mediaImported,
        ),
        skippedText:
          result.skippedFiles > 0
            ? strings.library.importDialog.summary.skipped(result.skippedFiles)
            : null,
      };
    },
  };
}
