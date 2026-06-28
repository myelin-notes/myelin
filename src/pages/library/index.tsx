import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { type FileType, useRepository, useRepositoryStatus } from '@/lib/sync';
import {
  enqueueManualRepositoryRefresh,
  useManualRepositoryRefreshAvailable,
  useManualRepositoryRefreshPending,
} from '@/lib/sync/manual-refresh';
import { CreateNewDropdown } from './create-new-dropdown';
import { GraphPane } from './graph-pane';
import { ImportDialog, type ImportSource } from './import/dialog';
import {
  importStorageFile,
  isStorageFile,
  STORAGE_FILE_ACCEPT,
} from './import/files';
import {
  GOODNOTES_ZIP_FILE_ACCEPT,
  importGoodnotesZip,
  isZipFile,
} from './import/goodnotes';
import {
  importMarkdownFile,
  isMarkdownFile,
  MARKDOWN_FILE_ACCEPT,
} from './import/markdown';
import { createObsidianVaultImportSource } from './import/obsidian-source';
import {
  importPdfFile,
  isNativeGoodnotesFile,
  isPdfFile,
  PDF_FILE_ACCEPT,
} from './import/pdf';
import { createWorkspaceJsonImportSource } from './import/workspace-json-source';
import { FolderTree, type FolderTreeHandle } from './middle/folder-tree';
import { RecentList } from './middle/recent-list';
import { TagListPanel } from './middle/tag-list-panel';
import { LibraryRail } from './rail';
import type { LibraryLens, RecentBucket, SearchMode } from './types';
import { useFilePaneFiles } from './use-file-pane-files';
import { useRepositorySetupState } from './use-repository-setup-state';

const logger = new Logger('LibraryPage');
const LIBRARY_IMPORT_ACCEPT = `${MARKDOWN_FILE_ACCEPT},${PDF_FILE_ACCEPT},${STORAGE_FILE_ACCEPT}`;

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface SelectedFolder {
  id: string | null;
  name: string;
}

type PendingCreate =
  | { kind: 'folder' }
  | { kind: 'file'; title: string; type: FileType };

export function LibraryPage() {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const setupState = useRepositorySetupState();

  const folderTreeRef = useRef<FolderTreeHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const goodnotesZipInputRef = useRef<HTMLInputElement>(null);

  const [lens, setLens] = useState<LibraryLens>('files');
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder>({
    id: null,
    name: strings.library.allFiles,
  });
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTags = useMemo(() => [...activeTags], [activeTags]);
  const [recentBucket, setRecentBucket] = useState<RecentBucket | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('lexical');

  const [middleRefresh, setMiddleRefresh] = useState(0);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
    null,
  );

  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [importType, setImportType] = useState<
    'obsidian_vault' | 'workspace_json'
  >('obsidian_vault');

  const isRefreshingRepository = useManualRepositoryRefreshPending();
  const repositoryRefreshAvailable = useManualRepositoryRefreshAvailable(
    repositoryStatus.config,
    repositoryStatus.initializing,
  );

  // The selected file set defines the scope of the right-hand graph.
  const filePane = useFilePaneFiles({
    lens,
    selectedFolderId: selectedFolder.id,
    filterTags,
    recentBucket,
    searchQuery,
    searchMode,
    sortMode: 'name-asc',
    setupState,
  });
  const fileIds = useMemo(
    () => filePane.files.map((file) => file.id),
    [filePane.files],
  );

  const handleDataChanged = useCallback(async () => {
    setMiddleRefresh((value) => value + 1);
    await filePane.reload();
  }, [filePane]);

  useEffect(() => {
    if (repositoryStatus.lastRemoteSyncAt !== null) {
      setMiddleRefresh((value) => value + 1);
    }
  }, [repositoryStatus.lastRemoteSyncAt]);

  // Run a queued create once the Files lens (and its tree) is mounted.
  useEffect(() => {
    if (lens !== 'files' || !pendingCreate) {
      return;
    }
    const pending = pendingCreate;
    setPendingCreate(null);
    const handle = folderTreeRef.current;
    if (!handle) {
      return;
    }
    if (pending.kind === 'folder') {
      void handle.startNewFolder();
    } else {
      void handle
        .startNewFile(pending.title, pending.type)
        .then(() => trackEvent('note_created', { file_type: pending.type }))
        .catch((error) => {
          logger.error('Failed to create file', error);
          toast.error(strings.commandPalette.errors.createNote, {
            description: errorDescription(error),
          });
        });
    }
  }, [lens, pendingCreate, strings.commandPalette.errors.createNote]);

  const handleSelectFolder = useCallback(
    (id: string | null, name: string) => {
      setSelectedFolder({
        id,
        name: id === null ? strings.library.allFiles : name,
      });
    },
    [strings.library.allFiles],
  );

  const selectFolderById = useCallback(
    async (id: string | null) => {
      if (id === null) {
        setSelectedFolder({ id: null, name: strings.library.allFiles });
        return;
      }
      const node = await repository.getNode(id);
      setSelectedFolder({ id, name: node?.name ?? strings.library.allFiles });
    },
    [repository, strings.library.allFiles],
  );

  const handleRefreshRepository = useCallback(() => {
    if (!repositoryRefreshAvailable || repositoryStatus.initializing) {
      return;
    }
    enqueueManualRepositoryRefresh(async () => {
      try {
        await repository.refresh();
        await handleDataChanged();
      } catch (error) {
        toast.error(strings.library.refreshRepository.failed, {
          description: errorDescription(error),
        });
      }
    });
  }, [
    repository,
    repositoryRefreshAvailable,
    repositoryStatus.initializing,
    strings.library.refreshRepository.failed,
    handleDataChanged,
  ]);

  const handleNewFolder = useCallback(() => {
    setLens('files');
    setPendingCreate({ kind: 'folder' });
  }, []);

  const handleNewFile = useCallback((title: string, type: FileType) => {
    setLens('files');
    setSearchQuery('');
    setPendingCreate({ kind: 'file', title, type });
  }, []);

  const handleImportStorageFiles = async (files: File[]) => {
    const supportedFiles = files.filter(
      (file) => isMarkdownFile(file) || isPdfFile(file) || isStorageFile(file),
    );
    if (supportedFiles.length === 0) {
      toast.error(
        files.some(isNativeGoodnotesFile)
          ? strings.library.importGoodnotesZip.nativeFile
          : strings.library.importFiles.unsupportedFile,
      );
      return;
    }

    setIsImportingFiles(true);
    try {
      for (const file of supportedFiles) {
        if (isMarkdownFile(file)) {
          await importMarkdownFile({
            file,
            repository,
            parentId: selectedFolder.id,
            fallbackTitle: strings.library.createNew.untitledCanvas,
          });
        } else if (isPdfFile(file)) {
          await importPdfFile({
            file,
            repository,
            parentId: selectedFolder.id,
            fallbackTitle: strings.library.createNew.untitledCanvas,
          });
        } else {
          await importStorageFile({
            file,
            repository,
            parentId: selectedFolder.id,
          });
        }
      }
      await handleDataChanged();
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
      setIsImportingFiles(false);
    }
  };

  const handleImportGoodnotesZipFile = async (file: File) => {
    if (!isZipFile(file)) {
      toast.error(
        isNativeGoodnotesFile(file)
          ? strings.library.importGoodnotesZip.nativeFile
          : strings.library.importGoodnotesZip.unsupportedFile,
      );
      return;
    }

    setIsImportingFiles(true);
    try {
      const result = await importGoodnotesZip({
        file,
        repository,
        parentId: selectedFolder.id,
        fallbackTitle: strings.library.createNew.untitledCanvas,
      });
      setLens('files');
      await selectFolderById(result.focusFolderId);
      await handleDataChanged();
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
      setIsImportingFiles(false);
    }
  };

  const handleStorageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0 || isImportingFiles) {
      return;
    }
    void handleImportStorageFiles(files);
  };

  const handleGoodnotesZipInputChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0 || isImportingFiles) {
      return;
    }
    void handleImportGoodnotesZipFile(files[0]);
  };

  const handleImportObsidianVault = useCallback(async () => {
    if (isImportingFiles || importSource !== null) {
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
        parentId: selectedFolder.id,
        strings,
      }),
    );
  }, [isImportingFiles, importSource, repository, selectedFolder.id, strings]);

  const handleImportWorkspaceJson = useCallback(async () => {
    if (isImportingFiles || importSource !== null) {
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
        parentId: selectedFolder.id,
        strings,
      }),
    );
  }, [isImportingFiles, importSource, repository, selectedFolder.id, strings]);

  const handleImportDialogDone = useCallback(
    (rootFolderId: string) => {
      setLens('files');
      void selectFolderById(rootFolderId);
      void handleDataChanged();
      trackEvent('import_completed', { import_type: importType });
    },
    [selectFolderById, handleDataChanged, importType],
  );

  const handleImportFiles = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportGoodnotesZip = useCallback(() => {
    goodnotesZipInputRef.current?.click();
  }, []);

  const activityLabel = isImportingFiles
    ? strings.library.importFiles.loading
    : isRefreshingRepository
      ? strings.library.refreshRepository.loading
      : repositoryStatus.initializing &&
          repositoryStatus.config.kind !== 'local'
        ? strings.library.repositoryLoading
        : null;

  return (
    <div className="relative flex h-full w-full bg-page">
      <LibraryRail lens={lens} onLensChange={setLens} />

      <aside className="flex w-64 shrink-0 flex-col border-border-subtle/60 border-r bg-surface/20">
        <div className="flex items-center justify-end border-border-subtle/60 border-b px-3 py-2">
          <CreateNewDropdown
            onNewFolder={handleNewFolder}
            onNewFile={handleNewFile}
            onImportFiles={handleImportFiles}
            onImportGoodnotesZip={handleImportGoodnotesZip}
            onImportObsidianVault={handleImportObsidianVault}
            onImportWorkspaceJson={handleImportWorkspaceJson}
            importDisabled={isImportingFiles || importSource !== null}
          />
          <input
            ref={importInputRef}
            type="file"
            multiple
            accept={LIBRARY_IMPORT_ACCEPT}
            className="hidden"
            onChange={handleStorageInputChange}
          />
          <input
            ref={goodnotesZipInputRef}
            type="file"
            accept={GOODNOTES_ZIP_FILE_ACCEPT}
            className="hidden"
            onChange={handleGoodnotesZipInputChange}
          />
        </div>

        {lens === 'files' && (
          <FolderTree
            ref={folderTreeRef}
            selectedFolderId={selectedFolder.id}
            onSelect={handleSelectFolder}
            onChanged={() => void handleDataChanged()}
            setupState={setupState}
            refreshKey={middleRefresh}
          />
        )}
        {lens === 'recent' && (
          <RecentList
            selectedBucket={recentBucket}
            onSelect={setRecentBucket}
            setupState={setupState}
            version={middleRefresh}
          />
        )}
        {lens === 'tags' && (
          <TagListPanel
            activeTags={activeTags}
            onActiveTagsChanged={setActiveTags}
            onTagsChanged={() => void handleDataChanged()}
            setupState={setupState}
            refreshKey={middleRefresh}
          />
        )}
      </aside>

      <GraphPane
        fileIds={fileIds}
        filesLoading={filePane.loading}
        setupState={setupState}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchMode={searchMode}
        onSearchModeChange={setSearchMode}
        refreshKey={middleRefresh}
        activityLabel={activityLabel}
        refreshAvailable={repositoryRefreshAvailable}
        refreshing={isRefreshingRepository}
        refreshDisabled={
          repositoryStatus.initializing || isRefreshingRepository
        }
        onRefresh={handleRefreshRepository}
      />

      {importSource !== null && (
        <ImportDialog
          source={importSource}
          onImported={handleImportDialogDone}
          onClose={() => setImportSource(null)}
        />
      )}
    </div>
  );
}
