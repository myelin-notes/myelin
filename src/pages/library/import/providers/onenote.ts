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
          skippedText:
            notebook.skippedSections > 0
              ? source.skippedSections(notebook.skippedSections)
              : null,
          isEmpty: pages === 0,
        };
      },

      async run({ scanned, rootName, onProgress }) {
        const result = await importOneNote({
          path,
          repository,
          parentId,
          rootName,
          fallbackTitle: strings.library.createNew.untitledCanvas,
          onProgress,
        });

        const skipped = [
          result.skippedPages > 0 ? source.skipped(result.skippedPages) : null,
          scanned.skippedSections > 0
            ? source.skippedSections(scanned.skippedSections)
            : null,
        ].filter((text) => text !== null);

        return {
          focusNodeId: result.rootFolderId,
          text: source.summary(result.pagesImported),
          skippedText: skipped.length > 0 ? skipped.join(' · ') : null,
          stats: {
            count: result.pagesImported,
            skipped: result.skippedPages,
          },
        };
      },
    });
  },
};
