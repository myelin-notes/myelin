import { ObsidianIcon } from '../brand-icons';
import { getPathName, importObsidianVault, scanVault } from '../obsidian-vault';
import { createRootFolderImportJob } from './root-folder-job';
import { expectDirectory, type ImportProvider } from './types';

export const obsidianProvider: ImportProvider = {
  id: 'obsidian_vault',
  icon: ObsidianIcon,
  picker: { kind: 'directory' },

  createJob({ selection, repository, parentId, strings }) {
    const vaultPath = expectDirectory(selection);
    const source = strings.library.importSources.obsidian_vault;
    const shared = strings.library.importDialog;

    return createRootFolderImportJob({
      title: source.title,
      scanningLabel: source.scanning,
      emptyLabel: source.empty,
      rootName: getPathName(vaultPath),
      repository,
      parentId,

      scan: () => scanVault(vaultPath),

      preview: (scanned) => ({
        lines: [
          {
            icon: 'note',
            text: shared.notes(
              scanned.files.filter((file) => file.kind === 'markdown').length,
            ),
          },
          {
            icon: 'media',
            text: shared.media(
              scanned.files.filter((file) => file.kind !== 'markdown').length,
            ),
          },
        ],
        skippedText:
          scanned.skippedFiles > 0
            ? shared.skippedFiles(scanned.skippedFiles)
            : null,
        isEmpty: scanned.files.length === 0,
      }),

      async run({ scanned, rootName, onProgress }) {
        const result = await importObsidianVault({
          repository,
          parentId,
          vaultPath,
          vaultName: rootName,
          scanned,
          onProgress,
        });

        return {
          focusNodeId: result.rootFolderId,
          text: shared.summary.imported(
            result.notesImported,
            result.mediaImported,
          ),
          skippedText:
            result.skippedFiles > 0
              ? shared.summary.skipped(result.skippedFiles)
              : null,
          stats: {
            count: result.notesImported + result.mediaImported,
            skipped: result.skippedFiles,
          },
        };
      },
    });
  },
};
