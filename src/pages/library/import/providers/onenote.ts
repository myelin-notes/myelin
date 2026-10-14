import { OneNoteIcon } from '../brand-icons';
import {
  importOneNote,
  ONENOTE_DIALOG_FILTERS,
  type OneNotePreview,
  oneNoteRootName,
  scanOneNoteFile,
} from '../onenote';
import { createRootFolderImportJob } from './root-folder-job';
import { expectFilePath, type ImportProvider } from './types';

export const onenoteProvider: ImportProvider = {
  id: 'onenote',
  icon: OneNoteIcon,
  picker: { kind: 'file', filters: ONENOTE_DIALOG_FILTERS },

  createJob({ selection, repository, parentId, strings }) {
    const path = expectFilePath(selection);
    const source = strings.library.importSources.onenote;

    return createRootFolderImportJob<OneNotePreview>({
      title: source.title,
      scanningLabel: source.scanning,
      emptyLabel: source.empty,
      rootName: oneNoteRootName(path),
      repository,
      parentId,

      scan: () => scanOneNoteFile(path),

      preview: (notebook) => {
        const pages = notebook.pages;
        return {
          lines: [
            { icon: 'page', text: source.pages(pages) },
            { icon: 'note', text: source.sections(notebook.sections) },
          ],
          skippedText: null,
          isEmpty: pages === 0,
        };
      },

      async run({ rootName, onProgress }) {
        const result = await importOneNote({
          path,
          repository,
          parentId,
          rootName,
          fallbackTitle: strings.library.createNew.untitledCanvas,
          onProgress,
        });

        return {
          focusNodeId: result.rootFolderId,
          text: source.summary(result.pagesImported),
          skippedText:
            result.skippedPages > 0
              ? source.skipped(result.skippedPages)
              : null,
          stats: {
            count: result.pagesImported,
            skipped: result.skippedPages,
          },
        };
      },
    });
  },
};
