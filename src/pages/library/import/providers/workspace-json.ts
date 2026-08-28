import { FileJson } from 'lucide-react';
import {
  getPathName,
  importWorkspaceJson,
  scanWorkspaceJson,
} from '../workspace-json';
import { createRootFolderImportJob } from './root-folder-job';
import { expectDirectory, type ImportProvider } from './types';

export const workspaceJsonProvider: ImportProvider = {
  id: 'workspace_json',
  icon: FileJson,
  picker: { kind: 'directory' },

  createJob({ selection, repository, parentId, strings }) {
    const dirPath = expectDirectory(selection);
    const source = strings.library.importSources.workspace_json;
    const shared = strings.library.importDialog;

    return createRootFolderImportJob({
      title: source.title,
      scanningLabel: source.scanning,
      emptyLabel: source.empty,
      rootName: getPathName(dirPath),
      repository,
      parentId,

      scan: () => scanWorkspaceJson(dirPath),

      preview: (scanned) => ({
        lines: [
          { icon: 'note', text: shared.notes(scanned.notes.length) },
          { icon: 'media', text: shared.media(scanned.media.length) },
        ],
        skippedText:
          scanned.skippedFiles > 0
            ? shared.skippedFiles(scanned.skippedFiles)
            : null,
        isEmpty: scanned.notes.length === 0 && scanned.media.length === 0,
      }),

      async run({ scanned, rootName, onProgress }) {
        const result = await importWorkspaceJson({
          repository,
          parentId,
          dirPath,
          rootName,
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
