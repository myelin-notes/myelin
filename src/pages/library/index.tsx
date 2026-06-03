import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  CalendarPlus,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note-navigation';
import {
  type FileType,
  useRepository,
  useRepositoryStatus,
  type VFSFileNode,
  type VFSFolderNode,
} from '@/lib/sync';
import {
  enqueueManualRepositoryRefresh,
  useManualRepositoryRefreshAvailable,
  useManualRepositoryRefreshPending,
} from '@/lib/sync/manual-refresh';
import { useTabController } from '@/lib/tabs/context';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { CreateNewDropdown } from './create-new-dropdown';
import {
  ExplorerTree,
  type ExplorerTreeHandle,
  type SortMode,
  type ViewMode,
} from './explorer/explorer-tree';
import { ImportDialog, type ImportSource } from './import-dialog';
import {
  importStorageFile,
  isStorageFile,
  STORAGE_FILE_ACCEPT,
} from './import-files';
import {
  GOODNOTES_ZIP_FILE_ACCEPT,
  importGoodnotesZip,
  isZipFile,
} from './import-goodnotes';
import {
  importMarkdownFile,
  isMarkdownFile,
  MARKDOWN_FILE_ACCEPT,
} from './import-markdown';
import { createObsidianVaultImportSource } from './import-obsidian-source';
import {
  importPdfFile,
  isNativeGoodnotesFile,
  isPdfFile,
  PDF_FILE_ACCEPT,
} from './import-pdf';
import { RecentCard } from './recent-card';
import { SemanticTags } from './semantic-tags';

const logger = new Logger('LibraryPage');
const LIBRARY_IMPORT_ACCEPT = `${MARKDOWN_FILE_ACCEPT},${PDF_FILE_ACCEPT},${STORAGE_FILE_ACCEPT}`;
const SORT_MODES: SortMode[] = ['name-asc', 'name-desc', 'modified', 'created'];

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function LibraryPage() {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const tabController = useTabController();
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const goodnotesZipInputRef = useRef<HTMLInputElement>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<VFSFolderNode[]>([]);
  const dragTimerRef = useRef<number | null>(null);
  const [breadcrumbDragIdx, setBreadcrumbDragIdx] = useState<number | null>(
    null,
  );
  const [semanticTagsVersion, setSemanticTagsVersion] = useState(0);
  const [recentFiles, setRecentFiles] = useState<VFSFileNode[]>([]);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTagsArr = useMemo(() => [...activeTags], [activeTags]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('name-asc');
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const isRefreshingRepository = useManualRepositoryRefreshPending();
  const recentFilesRequestRef = useRef(0);
  const cycleSortMode = () => {
    setSortMode(
      (prev) => SORT_MODES[(SORT_MODES.indexOf(prev) + 1) % SORT_MODES.length],
    );
  };
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    UserPrefs.get('explorerViewMode'),
  );
  const repositoryRefreshAvailable = useManualRepositoryRefreshAvailable(
    repositoryStatus.config,
    repositoryStatus.initializing,
  );
  const activityLabel = isImportingFiles
    ? strings.library.importFiles.loading
    : isRefreshingRepository
      ? strings.library.refreshRepository.loading
      : repositoryStatus.initializing &&
          repositoryStatus.config.kind !== 'local'
        ? strings.library.repositoryLoading
        : null;
  useEffect(() => UserPrefs.subscribe('explorerViewMode', setViewMode), []);
  const toggleViewMode = () => {
    UserPrefs.set('explorerViewMode', viewMode === 'tree' ? 'grid' : 'tree');
  };

  const loadRecentFiles = useCallback(async () => {
    const requestId = recentFilesRequestRef.current + 1;
    recentFilesRequestRef.current = requestId;

    try {
      const files = await repository.getRecentFiles(3);
      if (requestId === recentFilesRequestRef.current) {
        setRecentFiles(files);
      }
    } catch (error) {
      if (requestId === recentFilesRequestRef.current) {
        logger.error('Failed to load recent files', error);
      }
    }
  }, [repository]);

  const refreshLibraryData = useCallback(() => {
    setSemanticTagsVersion((version) => version + 1);
    void loadRecentFiles();
  }, [loadRecentFiles]);

  const triggerRefresh = useCallback(() => {
    refreshLibraryData();
    explorerRef.current?.reload();
  }, [refreshLibraryData]);

  const handleRefreshRepository = useCallback(() => {
    if (!repositoryRefreshAvailable || repositoryStatus.initializing) {
      return;
    }

    enqueueManualRepositoryRefresh(async () => {
      try {
        await repository.refresh();
        triggerRefresh();
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
    triggerRefresh,
  ]);

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
            parentId: currentFolderId,
            fallbackTitle: strings.library.createNew.untitledCanvas,
          });
        } else if (isPdfFile(file)) {
          await importPdfFile({
            file,
            repository,
            parentId: currentFolderId,
            fallbackTitle: strings.library.createNew.untitledCanvas,
          });
        } else {
          await importStorageFile({
            file,
            repository,
            parentId: currentFolderId,
          });
        }
      }
      triggerRefresh();

      if (supportedFiles.length !== files.length) {
        toast.error(strings.library.importFiles.someUnsupported);
      }
    } catch (error) {
      toast.error(strings.library.importFiles.failed, {
        description: error instanceof Error ? error.message : String(error),
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
        parentId: currentFolderId,
        fallbackTitle: strings.library.createNew.untitledCanvas,
      });
      setCurrentFolderId(result.focusFolderId);
      triggerRefresh();
      if (result.skippedFiles > 0) {
        toast.info(
          strings.library.importGoodnotesZip.skipped(result.skippedFiles),
        );
      }
    } catch (error) {
      toast.error(strings.library.importGoodnotesZip.failed, {
        description: error instanceof Error ? error.message : String(error),
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

    setImportSource(
      createObsidianVaultImportSource({
        vaultPath: selected,
        repository,
        parentId: currentFolderId,
        strings,
      }),
    );
  }, [isImportingFiles, importSource, repository, currentFolderId, strings]);

  const handleImportDialogDone = useCallback(
    (rootFolderId: string) => {
      setCurrentFolderId(rootFolderId);
      triggerRefresh();
    },
    [triggerRefresh],
  );

  const handleNewFolder = useCallback(() => {
    void explorerRef.current?.startNewFolder();
  }, []);

  const handleNewFile = useCallback(
    (title: string, type: FileType) => {
      void explorerRef.current?.startNewFile(title, type).catch((error) => {
        logger.error('Failed to create explorer file', error, {
          currentFolderId,
          fileType: type,
        });
        toast.error(strings.commandPalette.errors.createNote, {
          description: errorDescription(error),
        });
      });
    },
    [currentFolderId, strings.commandPalette.errors.createNote],
  );

  const handleImportFiles = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportGoodnotesZip = useCallback(() => {
    goodnotesZipInputRef.current?.click();
  }, []);

  useEffect(() => {
    void loadRecentFiles();
  }, [loadRecentFiles]);

  useEffect(() => {
    if (repositoryStatus.lastRemoteSyncAt !== null) {
      refreshLibraryData();
    }
  }, [refreshLibraryData, repositoryStatus.lastRemoteSyncAt]);

  // Update breadcrumbs when folder changes
  useEffect(() => {
    if (currentFolderId === null) {
      setBreadcrumbs([]);
      return;
    }
    let cancelled = false;
    repository
      .getFolderChain(currentFolderId)
      .then((nextBreadcrumbs) => {
        if (!cancelled) {
          setBreadcrumbs(nextBreadcrumbs);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        logger.error('Failed to load breadcrumbs', error, { currentFolderId });
      });

    return () => {
      cancelled = true;
    };
  }, [currentFolderId, repository]);

  const clearDragTimer = () => {
    if (dragTimerRef.current) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  };

  const handleBreadcrumbDrop = async (
    e: React.DragEvent,
    targetFolderId: string | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    clearDragTimer();
    setBreadcrumbDragIdx(null);

    const raw = e.dataTransfer.getData('application/myelin-item');
    if (!raw) {
      return;
    }

    const { nodeId } = JSON.parse(raw) as { nodeId: string };

    try {
      await repository.moveNode(nodeId, targetFolderId);
      setCurrentFolderId(targetFolderId);
      triggerRefresh();
    } catch (err) {
      logger.error('Failed to move item from breadcrumb', err, {
        nodeId,
        targetFolderId,
      });
    }
  };

  const makeBreadcrumbDragHandlers = (
    targetFolderId: string | null,
    idx: number,
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/myelin-item')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragEnter: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('application/myelin-item')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setBreadcrumbDragIdx(idx);
      clearDragTimer();
      dragTimerRef.current = window.setTimeout(() => {
        setCurrentFolderId(targetFolderId);
        setBreadcrumbDragIdx(null);
      }, 800);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.stopPropagation();
      setBreadcrumbDragIdx((prev) => (prev === idx ? null : prev));
      clearDragTimer();
    },
    onDrop: (e: React.DragEvent) => handleBreadcrumbDrop(e, targetFolderId),
  });

  return (
    <div className="relative flex h-full w-full bg-page">
      <a href="#library-main" data-skip-link className="skip-link">
        {strings.library.title}
      </a>

      <main
        ref={scrollRef}
        id="library-main"
        className="flex-1 overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:px-10 md:pt-12 lg:px-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          <h1
            className="font-extralight font-heading text-text-primary leading-[1.05]"
            style={{ fontSize: 'var(--fluid-display)' }}
          >
            {strings.library.title}
          </h1>

          {recentFiles.length === 0 && (
            <p className="mt-3 max-w-lg font-normal text-sm text-text-muted leading-relaxed">
              {strings.library.emptyState}
            </p>
          )}

          {/* Recently Opened */}
          {recentFiles.length > 0 && (
            <section className="mt-6">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="font-heading font-normal text-2xl text-text-primary leading-8">
                  {strings.library.recentlyOpened}
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recentFiles.map((file, i) => (
                  <motion.div
                    key={file.id}
                    className="min-w-0"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.4,
                      delay: i * 0.08,
                      ease: [0.25, 0.1, 0.25, 1],
                    }}
                  >
                    <RecentCard
                      nodeId={file.id}
                      category={
                        strings.library.fileTypes[
                          file.fileType as keyof typeof strings.library.fileTypes
                        ] ?? file.fileType
                      }
                      time={formatRelativeTime(file.modifiedAt, locale, {
                        style: 'short',
                      })}
                      title={file.name}
                      tags={file.tags}
                      featured={i === 0}
                      onClick={() => openNote(tabController, file, file.name)}
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Explorer + Tags */}
          <section className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-8 lg:col-span-8">
              <div className="group flex items-center gap-1 rounded-2xl bg-card/75 px-3 py-2 ring-1 ring-border-subtle/70 transition-all duration-200 focus-within:bg-card focus-within:shadow-ambient focus-within:ring-accent-dark/15 hover:bg-card">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors duration-200 group-focus-within:text-accent-dark">
                  <Search className="size-3.5" />
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={strings.library.searchPlaceholder}
                  aria-label={strings.library.searchPlaceholder}
                  className="w-full min-w-0 bg-transparent py-2 font-normal text-[15px] text-text-primary outline-none placeholder:text-text-muted"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label={strings.common.clear}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text-primary"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-heading font-normal text-2xl leading-8">
                    <button
                      type="button"
                      onClick={() => setCurrentFolderId(null)}
                      className={cn(
                        '-mx-2 cursor-pointer rounded-lg px-2 py-0.5 transition-colors',
                        breadcrumbDragIdx === -1
                          ? 'bg-accent/15 text-accent-foreground'
                          : 'text-text-primary hover:bg-hover-tint hover:text-text-secondary',
                      )}
                      {...makeBreadcrumbDragHandlers(null, -1)}
                    >
                      {strings.library.explorer}
                    </button>
                  </h3>
                  {breadcrumbs.length > 0 && (
                    <div className="flex items-center gap-1 text-sm text-text-muted">
                      <ChevronRight className="size-3.5 shrink-0" />
                      {breadcrumbs.map((crumb, i) => {
                        const isLast = i === breadcrumbs.length - 1;
                        const isDragTarget = breadcrumbDragIdx === i;
                        return (
                          <span
                            key={crumb.id}
                            className="flex items-center gap-1"
                          >
                            {i > 0 && (
                              <ChevronRight className="size-3 shrink-0 text-text-muted" />
                            )}
                            <button
                              onClick={() => setCurrentFolderId(crumb.id)}
                              className={`rounded px-1 transition-colors ${
                                isDragTarget
                                  ? 'bg-accent/15 text-accent-foreground ring-1 ring-accent/40'
                                  : isLast
                                    ? 'font-medium text-text-secondary'
                                    : 'cursor-pointer text-text-muted hover:text-text-secondary'
                              }`}
                              {...makeBreadcrumbDragHandlers(crumb.id, i)}
                            >
                              {crumb.name}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  {activityLabel && (
                    <div
                      role="status"
                      className="mr-1 flex min-w-0 items-center gap-2 rounded-lg bg-surface px-2.5 py-1 text-text-muted text-xs"
                    >
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                      <span className="truncate">{activityLabel}</span>
                    </div>
                  )}
                  {repositoryRefreshAvailable && (
                    <button
                      type="button"
                      onClick={handleRefreshRepository}
                      disabled={
                        repositoryStatus.initializing || isRefreshingRepository
                      }
                      aria-label={strings.library.refreshRepository.label}
                      title={strings.library.refreshRepository.label}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150',
                        repositoryStatus.initializing || isRefreshingRepository
                          ? 'cursor-default opacity-60'
                          : 'cursor-pointer hover:bg-hover-tint hover:text-text-primary',
                      )}
                    >
                      <RefreshCw
                        className={cn(
                          'size-4',
                          isRefreshingRepository && 'animate-spin',
                        )}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cycleSortMode}
                    aria-label={strings.library.sortLabel(
                      strings.library.sortModes[sortMode],
                    )}
                    title={strings.library.sortLabel(
                      strings.library.sortModes[sortMode],
                    )}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
                  >
                    {sortMode === 'name-asc' && (
                      <ArrowDownAZ className="size-4" />
                    )}
                    {sortMode === 'name-desc' && (
                      <ArrowDownZA className="size-4" />
                    )}
                    {sortMode === 'modified' && <Clock className="size-4" />}
                    {sortMode === 'created' && (
                      <CalendarPlus className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={toggleViewMode}
                    aria-label={strings.library.viewModeLabel(
                      strings.library.viewModes[viewMode],
                    )}
                    title={strings.library.viewModeLabel(
                      strings.library.viewModes[viewMode],
                    )}
                    className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
                  >
                    {viewMode === 'tree' ? (
                      <List className="size-4" />
                    ) : (
                      <LayoutGrid className="size-4" />
                    )}
                  </button>
                  <CreateNewDropdown
                    onNewFolder={handleNewFolder}
                    onNewFile={handleNewFile}
                    onImportFiles={handleImportFiles}
                    onImportGoodnotesZip={handleImportGoodnotesZip}
                    onImportObsidianVault={handleImportObsidianVault}
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
              </div>

              <ExplorerTree
                ref={explorerRef}
                scrollRef={scrollRef}
                currentFolderId={currentFolderId}
                onNavigate={setCurrentFolderId}
                onChanged={refreshLibraryData}
                sortMode={sortMode}
                viewMode={viewMode}
                searchQuery={searchQuery}
                filterTags={filterTagsArr}
              />
            </div>

            <div className="lg:col-span-4">
              <SemanticTags
                key={semanticTagsVersion}
                activeTags={activeTags}
                onActiveTagsChanged={setActiveTags}
              />
            </div>
          </section>
        </motion.div>
      </main>

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
