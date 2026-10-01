import { Import } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import {
  getFileTypeForName,
  ImportableFileTypes,
  type VFSNodeId,
} from '@/lib/sync';
import { importStoragePath, isStorageFile } from '../files';
import { getPathBasename } from '../import-tree';
import { importMarkdownFile, isMarkdownFile } from '../markdown';
import { importPdfFile, isNativeGoodnotesFile, isPdfFile } from '../pdf';
import type { ImportProvider } from './types';

interface NativeImportFile {
  path: string;
  name: string;
  type: string;
}

interface PartitionedFiles {
  /** Importable files, kept in the order the user picked them. */
  supported: NativeImportFile[];
  noteCount: number;
  mediaCount: number;
  unsupported: NativeImportFile[];
}

function partition(files: NativeImportFile[]): PartitionedFiles {
  const supported: NativeImportFile[] = [];
  const unsupported: NativeImportFile[] = [];
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
  picker: {
    kind: 'native-files',
    filters: [
      {
        name: 'Importable files',
        extensions: ['md', 'markdown', 'mdx', 'pdf', ...ImportableFileTypes],
      },
    ],
    multiple: true,
  },

  createJob({ selection, repository, parentId, strings }) {
    if (selection.kind !== 'native-files') {
      throw new Error('Expected a native file selection');
    }
    const files = selection.paths.map((path) => ({
      path,
      name: getPathBasename(path, path),
      type: '',
    }));
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
        for (const file of files) {
          if (file.path.includes('://')) {
            file.name = await invoke<string>('import_file_name', {
              path: file.path,
            });
          }
        }
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

          if (isStorageFile(file) && !isPdfFile(file)) {
            const name = await repository.getUniqueFileName(
              file.name,
              parentId,
            );
            lastId = await importStoragePath({
              path: file.path,
              name,
              fileType: getFileTypeForName(file.name)!,
              repository,
              parentId,
            });
            continue;
          }
          const input = new File([await readFile(file.path)], file.name);
          if (isMarkdownFile(file)) {
            lastId = await importMarkdownFile({
              file: input,
              repository,
              parentId,
              fallbackTitle,
            });
          } else if (isPdfFile(file)) {
            lastId = await importPdfFile({
              file: input,
              repository,
              parentId,
              fallbackTitle,
            });
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
