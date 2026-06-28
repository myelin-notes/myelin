import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { TAB_BAR_HEIGHT_CLASS } from '@/lib/platform';
import { type FileType, useRepository, useRepositoryStatus } from '@/lib/sync';
import {
  enqueueManualRepositoryRefresh,
  useManualRepositoryRefreshAvailable,
  useManualRepositoryRefreshPending,
} from '@/lib/sync/manual-refresh';
import { cn } from '@/lib/utils';
import { CreateNewDropdown } from '@/pages/library/create-new-dropdown';
import { ImportDialog, type ImportSource } from '@/pages/library/import/dialog';
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
import { FlatFileList } from '@/pages/library/middle/flat-file-list';
import {
  FolderTree,
  type FolderTreeHandle,
} from '@/pages/library/middle/folder-tree';
import { TagListPanel } from '@/pages/library/middle/tag-list-panel';
import { LibraryRail } from '@/pages/library/rail';
import type { LibraryLens, SearchMode } from '@/pages/library/types';
import { useFilePaneFiles } from '@/pages/library/use-file-pane-files';
import { useRepositorySetupState } from '@/pages/library/use-repository-setup-state';

const logger = new Logger('LibrarySidebar');
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

/**
 * Persistent left sidebar: the lens rail plus the file browser (search, folder
 * tree, recent and tag lists). Lives at the app-shell level so it stays put
 * regardless of which tab the editor area is showing. Selecting a file opens it
 * as a tab in the focused pane.
 */
export function LibrarySidebar() {
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

  const isSearching = searchQuery.trim().length > 0;

  // Flat result set for the search view and the Recent / Tags lenses. The Files
  // lens shows the hierarchical tree instead and ignores this.
  const filePane = useFilePaneFiles({
    lens,
    selectedFolderId: selectedFolder.id,
    filterTags,
    recentBucket: null,
    searchQuery,
    searchMode,
    sortMode: 'name-asc',
    setupState,
  });

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
    setSearchQuery('');
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
    <aside className="flex h-full shrink-0 bg-page">
      <LibraryRail lens={lens} onLensChange={setLens} />

      <div className="flex w-64 shrink-0 flex-col border-border-subtle/60 border-r bg-surface/20">
        <div
          data-tauri-drag-region
          className={cn(
            'flex shrink-0 items-center justify-end gap-1 border-border-subtle/60 border-b px-2',
            TAB_BAR_HEIGHT_CLASS,
          )}
        >
          {activityLabel && (
            <div
              role="status"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-text-muted text-xs"
            >
              <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
              <span className="truncate">{activityLabel}</span>
            </div>
          )}
          {repositoryRefreshAvailable && (
            <button
              type="button"
              onClick={handleRefreshRepository}
              disabled={repositoryStatus.initializing || isRefreshingRepository}
              aria-label={strings.library.refreshRepository.label}
              title={strings.library.refreshRepository.label}
              className={cn(
                'flex size-7 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150',
                repositoryStatus.initializing || isRefreshingRepository
                  ? 'cursor-default opacity-60'
                  : 'cursor-pointer hover:bg-hover-tint hover:text-text-primary',
              )}
            >
              <RefreshCw
                className={cn(
                  'size-3.5',
                  isRefreshingRepository && 'animate-spin',
                )}
              />
            </button>
          )}
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

        <div className="border-border-subtle/60 border-b px-2 py-2">
          <div className="group flex items-center gap-1 rounded-lg bg-card/75 px-2 py-1 ring-1 ring-border-subtle/70 transition-all duration-200 focus-within:bg-card focus-within:ring-accent-dark/15 hover:bg-card">
            <Search className="size-3.5 shrink-0 text-text-muted transition-colors group-focus-within:text-accent-dark" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={strings.library.searchPlaceholder}
              aria-label={strings.library.searchPlaceholder}
              className="w-full min-w-0 bg-transparent py-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label={strings.common.clear}
                className="flex size-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex">
            <SearchModeToggle
              mode={searchMode}
              onChange={setSearchMode}
              keywordLabel={strings.library.searchModes.lexical}
              semanticLabel={strings.library.searchModes.semantic}
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {isSearching ? (
            <FlatFileList
              title={strings.library.searchResults}
              files={filePane.files}
              loading={filePane.loading}
              emptyLabel={strings.library.searchEmpty}
              onChanged={() => void handleDataChanged()}
            />
          ) : lens === 'files' ? (
            <FolderTree
              ref={folderTreeRef}
              selectedFolderId={selectedFolder.id}
              onSelect={handleSelectFolder}
              onChanged={() => void handleDataChanged()}
              setupState={setupState}
              refreshKey={middleRefresh}
            />
          ) : lens === 'recent' ? (
            <FlatFileList
              title={strings.library.lens.recent}
              files={filePane.files}
              loading={filePane.loading}
              emptyLabel={strings.library.recentEmpty}
              onChanged={() => void handleDataChanged()}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">
                <TagListPanel
                  activeTags={activeTags}
                  onActiveTagsChanged={setActiveTags}
                  onTagsChanged={() => void handleDataChanged()}
                  setupState={setupState}
                  refreshKey={middleRefresh}
                />
              </div>
              {activeTags.size > 0 && (
                <div className="flex min-h-0 flex-1 flex-col border-border-subtle/60 border-t">
                  <FlatFileList
                    title={strings.library.taggedFiles}
                    files={filePane.files}
                    loading={filePane.loading}
                    emptyLabel={strings.library.searchEmpty}
                    onChanged={() => void handleDataChanged()}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {importSource !== null && (
        <ImportDialog
          source={importSource}
          onImported={handleImportDialogDone}
          onClose={() => setImportSource(null)}
        />
      )}
    </aside>
  );
}

function SearchModeToggle({
  mode,
  onChange,
  keywordLabel,
  semanticLabel,
}: {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  keywordLabel: string;
  semanticLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-lg bg-surface p-0.5">
      {(
        [
          ['lexical', keywordLabel],
          ['semantic', semanticLabel],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={mode === value}
          className={cn(
            'cursor-pointer rounded-[6px] px-2 py-0.5 font-medium text-[11px] transition-colors duration-150',
            mode === value
              ? 'bg-tag-active text-text-on-dark'
              : 'text-text-muted hover:text-text-primary',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
