import { GoodnotesIcon } from '../brand-icons';
import {
  GOODNOTES_ZIP_FILE_ACCEPT,
  importGoodnotesZip,
  readGoodnotesZipEntries,
  type ScannedGoodnotesZip,
} from '../goodnotes';
import { expectFiles, type ImportProvider } from './types';

export const goodnotesProvider: ImportProvider = {
  id: 'goodnotes_zip',
  icon: GoodnotesIcon,
  picker: { kind: 'files', accept: GOODNOTES_ZIP_FILE_ACCEPT, multiple: false },

  createJob({ selection, repository, parentId, strings }) {
    const file = expectFiles(selection)[0];
    const source = strings.library.importSources.goodnotes_zip;
    const shared = strings.library.importDialog;
    let scanned: ScannedGoodnotesZip | null = null;

    // The zip's own folders land directly under `parentId`, so there is no root
    // folder to collide with and nothing for the conflict prompt to resolve.
    return {
      title: source.title,
      scanningLabel: source.scanning,
      emptyLabel: source.empty,

      async scan() {
        scanned = await readGoodnotesZipEntries(file);
        return {
          name: file.name,
          lines: [
            { icon: 'note', text: source.pdfs(scanned.pdfEntries.length) },
          ],
          skippedText:
            scanned.skippedFiles > 0
              ? shared.skippedFiles(scanned.skippedFiles)
              : null,
          isEmpty: scanned.pdfEntries.length === 0,
          conflict: null,
        };
      },

      async run({ onProgress }) {
        if (scanned === null) {
          throw new Error('Must scan before importing');
        }

        const result = await importGoodnotesZip({
          scanned,
          repository,
          parentId,
          fallbackTitle: strings.library.createNew.untitledCanvas,
          onProgress,
        });

        return {
          focusNodeId: result.focusFolderId,
          text: source.summary(result.pdfsImported),
          skippedText:
            result.skippedFiles > 0
              ? shared.summary.skipped(result.skippedFiles)
              : null,
          stats: {
            count: result.pdfsImported,
            skipped: result.skippedFiles,
          },
        };
      },
    };
  },
};
