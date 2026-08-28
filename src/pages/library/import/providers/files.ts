import { Import } from 'lucide-react';
import type { VFSNodeId } from '@/lib/sync';
import {
  importStorageFile,
  isStorageFile,
  STORAGE_FILE_ACCEPT,
} from '../files';
import {
  importMarkdownFile,
  isMarkdownFile,
  MARKDOWN_FILE_ACCEPT,
} from '../markdown';
import {
  importPdfFile,
  isNativeGoodnotesFile,
  isPdfFile,
  PDF_FILE_ACCEPT,
} from '../pdf';
import { expectFiles, type ImportProvider } from './types';

const FILES_ACCEPT = `${MARKDOWN_FILE_ACCEPT},${PDF_FILE_ACCEPT},${STORAGE_FILE_ACCEPT}`;

interface PartitionedFiles {
  /** Importable files, kept in the order the user picked them. */
  supported: File[];
  noteCount: number;
  mediaCount: number;
  unsupported: File[];
}

function partition(files: File[]): PartitionedFiles {
  const supported: File[] = [];
  const unsupported: File[] = [];
  let noteCount = 0;
  let mediaCount = 0;

  for (const file of files) {
    if (isMarkdownFile(file) || isPdfFile(file)) {
      supported.push(file);
      noteCount++;
    } else if (isStorageFile(file)) {
      supported.push(file);
      mediaCount++;
    } else {
      unsupported.push(file);
    }
  }

  return { supported, noteCount, mediaCount, unsupported };
}

export const filesProvider: ImportProvider = {
  id: 'files',
  icon: Import,
  picker: { kind: 'files', accept: FILES_ACCEPT, multiple: true },

  createJob({ selection, repository, parentId, strings }) {
    const files = expectFiles(selection);
    const source = strings.library.importSources.files;
    const shared = strings.library.importDialog;
    let scanned: PartitionedFiles | null = null;

    // Loose files land straight in `parentId`; no root folder, so nothing to
    // reveal afterwards and nothing for the conflict prompt to resolve.
    return {
      title: source.title,
      scanningLabel: source.scanning,
      emptyLabel: source.empty,

      async scan() {
        scanned = partition(files);
        return {
          name: source.selected(files.length),
          lines: [
            { icon: 'note', text: shared.notes(scanned.noteCount) },
            { icon: 'media', text: shared.media(scanned.mediaCount) },
          ],
          skippedText:
            scanned.unsupported.length > 0
              ? scanned.unsupported.some(isNativeGoodnotesFile)
                ? source.nativeFile
                : shared.skippedFiles(scanned.unsupported.length)
              : null,
          isEmpty: scanned.supported.length === 0,
          conflict: null,
        };
      },

      async run({ onProgress }) {
        if (scanned === null) {
          throw new Error('Must scan before importing');
        }

        const { supported } = scanned;
        const fallbackTitle = strings.library.createNew.untitledCanvas;
        let lastId: VFSNodeId | null = null;

        for (const [index, file] of supported.entries()) {
          onProgress({
            current: index + 1,
            total: supported.length,
            fileName: file.name,
          });

          if (isMarkdownFile(file)) {
            lastId = await importMarkdownFile({
              file,
              repository,
              parentId,
              fallbackTitle,
            });
          } else if (isPdfFile(file)) {
            lastId = await importPdfFile({
              file,
              repository,
              parentId,
              fallbackTitle,
            });
          } else {
            lastId = await importStorageFile({ file, repository, parentId });
          }
        }

        return {
          focusNodeId: supported.length === 1 ? lastId : null,
          text: source.summary(supported.length),
          skippedText:
            scanned.unsupported.length > 0
              ? shared.summary.skipped(scanned.unsupported.length)
              : null,
          stats: {
            count: supported.length,
            skipped: scanned.unsupported.length,
          },
        };
      },
    };
  },
};
