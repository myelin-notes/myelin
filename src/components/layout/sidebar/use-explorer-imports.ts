import { type ChangeEvent, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { errorDescription } from '@/components/command-palette/utils';
import { trackEvent } from '@/lib/analytics';
import type { Messages } from '@/lib/i18n';
import { useRepository } from '@/lib/sync';
import type { ImportSource } from '@/pages/library/import/dialog';
import {
  importStorageFile,
  isStorageFile,
  STORAGE_FILE_ACCEPT,
} from '@/pages/library/import/files';
import {
  GOODNOTES_ZIP_FILE_ACCEPT,
  importGoodnotesZip,
  isZipFile,
} from '@/pages/library/import/goodnotes';
import {
  importMarkdownFile,
  isMarkdownFile,
  MARKDOWN_FILE_ACCEPT,
} from '@/pages/library/import/markdown';
import { createObsidianVaultImportSource } from '@/pages/library/import/obsidian-source';
import {
  importPdfFile,
  isNativeGoodnotesFile,
  isPdfFile,
  PDF_FILE_ACCEPT,
} from '@/pages/library/import/pdf';
import { createWorkspaceJsonImportSource } from '@/pages/library/import/workspace-json-source';

const SIDEBAR_IMPORT_ACCEPT = `${MARKDOWN_FILE_ACCEPT},${PDF_FILE_ACCEPT},${STORAGE_FILE_ACCEPT}`;

export interface ExplorerImports {
  isImporting: boolean;
  importDisabled: boolean;
  onImportFiles: () => void;
  onImportGoodnotesZip: () => void;
  onImportObsidianVault: () => Promise<void>;
  onImportWorkspaceJson: () => Promise<void>;
  storageInputRef: React.RefObject<HTMLInputElement | null>;
  goodnotesZipInputRef: React.RefObject<HTMLInputElement | null>;
  storageInputAccept: string;
  goodnotesZipInputAccept: string;
  handleStorageInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleGoodnotesZipInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  importSource: ImportSource | null;
  importType: 'obsidian_vault' | 'workspace_json';
  closeImportSource: () => void;
  handleImportDialogDone: (rootFolderId: string) => void;
}

interface UseExplorerImportsOptions {
  /** Folder new imports land in. Null is the library root. */
  parentId: string | null;
  /** Called after a successful import so the tree can reload. */
  onChanged: () => void;
  strings: Messages;
}

/**
 * Encapsulates the file/vault import handlers that used to live on the library
 * page, so the sidebar's create-new menu keeps full import parity. The caller
 * renders the hidden inputs and the import dialog from the returned state.
 */
export function useExplorerImports({
  parentId,
  onChanged,
  strings,
}: UseExplorerImportsOptions): ExplorerImports {
  const repository = useRepository();
  const storageInputRef = useRef<HTMLInputElement>(null);
  const goodnotesZipInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [importType, setImportType] = useState<
    'obsidian_vault' | 'workspace_json'
  >('obsidian_vault');

  const importDisabled = isImporting || importSource !== null;

  const handleImportStorageFiles = useCallback(
    async (files: File[]) => {
      const supportedFiles = files.filter(
        (file) =>
          isMarkdownFile(file) || isPdfFile(file) || isStorageFile(file),
      );
      if (supportedFiles.length === 0) {
        toast.error(
          files.some(isNativeGoodnotesFile)
            ? strings.library.importGoodnotesZip.nativeFile
            : strings.library.importFiles.unsupportedFile,
        );
        return;
      }

      setIsImporting(true);
      try {
        for (const file of supportedFiles) {
          if (isMarkdownFile(file)) {
            await importMarkdownFile({
              file,
              repository,
              parentId,
              fallbackTitle: strings.library.createNew.untitledCanvas,
            });
          } else if (isPdfFile(file)) {
            await importPdfFile({
              file,
              repository,
              parentId,
              fallbackTitle: strings.library.createNew.untitledCanvas,
            });
          } else {
            await importStorageFile({ file, repository, parentId });
          }
        }
        onChanged();
        trackEvent('import_completed', {
          import_type: 'storage',
          file_count: supportedFiles.length,
          partial_failure: supportedFiles.length !== files.length,
        });
        if (supportedFiles.length !== files.length) {
          toast.error(strings.library.importFiles.someUnsupported);
        }
      } catch (error) {
        toast.error(strings.library.importFiles.failed, {
          description: errorDescription(error),
        });
      } finally {
        setIsImporting(false);
      }
    },
    [onChanged, parentId, repository, strings],
  );

  const handleImportGoodnotesZipFile = useCallback(
    async (file: File) => {
      if (!isZipFile(file)) {
        toast.error(
          isNativeGoodnotesFile(file)
            ? strings.library.importGoodnotesZip.nativeFile
            : strings.library.importGoodnotesZip.unsupportedFile,
        );
        return;
      }

      setIsImporting(true);
      try {
        const result = await importGoodnotesZip({
          file,
          repository,
          parentId,
          fallbackTitle: strings.library.createNew.untitledCanvas,
        });
        onChanged();
        trackEvent('import_completed', {
          import_type: 'goodnotes_zip',
          file_count: result.pdfsImported,
          partial_failure: result.skippedFiles > 0,
        });
        if (result.skippedFiles > 0) {
          toast.info(
            strings.library.importGoodnotesZip.skipped(result.skippedFiles),
          );
        }
      } catch (error) {
        toast.error(strings.library.importGoodnotesZip.failed, {
          description: errorDescription(error),
        });
      } finally {
        setIsImporting(false);
      }
    },
    [onChanged, parentId, repository, strings],
  );

  const handleStorageInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length === 0 || isImporting) {
        return;
      }
      void handleImportStorageFiles(files);
    },
    [handleImportStorageFiles, isImporting],
  );

  const handleGoodnotesZipInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length === 0 || isImporting) {
        return;
      }
      void handleImportGoodnotesZipFile(files[0]);
    },
    [handleImportGoodnotesZipFile, isImporting],
  );

  const onImportFiles = useCallback(() => {
    storageInputRef.current?.click();
  }, []);

  const onImportGoodnotesZip = useCallback(() => {
    goodnotesZipInputRef.current?.click();
  }, []);

  const onImportObsidianVault = useCallback(async () => {
    if (importDisabled) {
      return;
    }
    const selected = await openDialog({
      directory: true,
      multiple: false,
      recursive: true,
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    setImportType('obsidian_vault');
    setImportSource(
      createObsidianVaultImportSource({
        vaultPath: selected,
        repository,
        parentId,
        strings,
      }),
    );
  }, [importDisabled, parentId, repository, strings]);

  const onImportWorkspaceJson = useCallback(async () => {
    if (importDisabled) {
      return;
    }
    const selected = await openDialog({
      directory: true,
      multiple: false,
      recursive: true,
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    setImportType('workspace_json');
    setImportSource(
      createWorkspaceJsonImportSource({
        dirPath: selected,
        repository,
        parentId,
        strings,
      }),
    );
  }, [importDisabled, parentId, repository, strings]);

  const handleImportDialogDone = useCallback(
    (_rootFolderId: string) => {
      onChanged();
      trackEvent('import_completed', { import_type: importType });
    },
    [onChanged, importType],
  );

  const closeImportSource = useCallback(() => setImportSource(null), []);

  return {
    isImporting,
    importDisabled,
    onImportFiles,
    onImportGoodnotesZip,
    onImportObsidianVault,
    onImportWorkspaceJson,
    storageInputRef,
    goodnotesZipInputRef,
    storageInputAccept: SIDEBAR_IMPORT_ACCEPT,
    goodnotesZipInputAccept: GOODNOTES_ZIP_FILE_ACCEPT,
    handleStorageInputChange,
    handleGoodnotesZipInputChange,
    importSource,
    importType,
    closeImportSource,
    handleImportDialogDone,
  };
}
