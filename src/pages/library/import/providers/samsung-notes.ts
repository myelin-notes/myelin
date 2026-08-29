import { PenLine } from 'lucide-react';
import {
  countSamsungNotesElements,
  importSamsungNotes,
  parseSamsungNotesFile,
  SAMSUNG_NOTES_DIALOG_FILTERS,
  type SamsungNotesNote,
  samsungNotesTitle,
} from '../samsung-notes';
import { expectFilePath, type ImportProvider } from './types';

export const samsungNotesProvider: ImportProvider = {
  id: 'samsung_notes',
  icon: PenLine,
  picker: { kind: 'file', filters: SAMSUNG_NOTES_DIALOG_FILTERS },

  createJob({ selection, repository, parentId, strings }) {
    const path = expectFilePath(selection);
    const source = strings.library.importSources.samsung_notes;
    const title = samsungNotesTitle(path);
    let scanned: SamsungNotesNote | null = null;

    // One .sdocx is one note, created directly under `parentId`;
    // `createCanvasFile` uniquifies the name, so there is no conflict to resolve.
    return {
      title: source.title,
      scanningLabel: source.scanning,
      emptyLabel: source.empty,

      async scan() {
        scanned = await parseSamsungNotesFile(path);
        return {
          name: title,
          lines: [
            { icon: 'page', text: source.pages(scanned.pages.length) },
            {
              icon: 'note',
              text: source.elements(countSamsungNotesElements(scanned)),
            },
          ],
          skippedText:
            scanned.skippedObjects > 0
              ? source.skippedObjects(scanned.skippedObjects)
              : null,
          isEmpty: countSamsungNotesElements(scanned) === 0,
          conflict: null,
        };
      },

      async run({ onProgress }) {
        if (scanned === null) {
          throw new Error('Must scan before importing');
        }

        onProgress({ current: 1, total: 1, fileName: title });
        const nodeId = await importSamsungNotes({
          note: scanned,
          repository,
          parentId,
          title,
        });

        return {
          focusNodeId: nodeId,
          text: source.summary(scanned.pages.length),
          skippedText:
            scanned.skippedObjects > 0
              ? source.skippedObjects(scanned.skippedObjects)
              : null,
          stats: {
            count: scanned.pages.length,
            skipped: scanned.skippedObjects,
          },
        };
      },
    };
  },
};
