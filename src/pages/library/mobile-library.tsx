import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  BrainCircuit,
  CalendarPlus,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  Network,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { formatRelativeTime } from '@myelin/editor/i18n/format';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { errorDescription } from '@/components/command-palette/utils';
import { SidebarTags } from '@/components/layout/sidebar/sidebar-tags';
import { useExplorerImports } from '@/components/layout/sidebar/use-explorer-imports';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { trackEvent } from '@/lib/analytics';
import { openNote } from '@/lib/note/navigation';
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
import { BetaFeedbackBanner } from './beta-feedback-banner';
import { CreateNewDropdown } from './create-new-dropdown';
import {
  ExplorerTree,
  type ExplorerTreeHandle,
  type SearchMode,
  type SortMode,
  type ViewMode,
} from './explorer/explorer-tree';
import { useDropTarget } from './explorer/use-drop-target';
import { ImportDialog } from './import/dialog';
import { RecentCard } from './recent-card';

const logger = new Logger('MobileLibrary');
const SORT_MODES: SortMode[] = ['name-asc', 'name-desc', 'modified', 'created'];
const RECENT_LIMIT = 3;

/**
 * Mobile-layout home surface. Instead of the desktop sidebar, the explorer gets
 * its own full page — a faithful revival of the pre-sidebar library home: a
 * single scrolling page with a "Library" header, a recently-opened card grid
 * (the first card featured), then an Explorer section (search, breadcrumbs, a
 * list/grid file explorer with folder drill-in) beside a tag-filter panel.
 * Shown by {@link AppShell} on the empty-pane home view; opening a document
 * covers it with a tab and the tab bar's library button returns here. Only
 * rendered in a mobile build — see {@link RootLayout}.
 */
export function MobileLibrary() {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const tabController = useTabController();
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const scrollRef = useRef<HTMLElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('lexical');
  const [sortMode, setSortMode] = useState<SortMode>('name-asc');
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<VFSFolderNode[]>([]);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTags = useMemo(() => [...activeTags], [activeTags]);
  const [tagsRefreshKey, setTagsRefreshKey] = useState(0);
  const [recentFiles, setRecentFiles] = useState<VFSFileNode[]>([]);
  const recentFilesRequestRef = useRef(0);

  const isRefreshing = useManualRepositoryRefreshPending();
  const refreshAvailable = useManualRepositoryRefreshAvailable(
    repositoryStatus.config,
    repositoryStatus.initializing,
  );

  const loadRecentFiles = useCallback(async () => {
    const requestId = recentFilesRequestRef.current + 1;
    recentFilesRequestRef.current = requestId;
    try {
      const files = await repository.getRecentFiles(RECENT_LIMIT);
      if (requestId === recentFilesRequestRef.current) {
        setRecentFiles(files);
      }
    } catch (error) {
      if (requestId === recentFilesRequestRef.current) {
        logger.error('Failed to load recent files', error);
      }
    }
  }, [repository]);

  const refreshMeta = useCallback(() => {
    setTagsRefreshKey((key) => key + 1);
  }, []);

  const refreshLibraryData = useCallback(() => {
    void explorerRef.current?.reload();
    refreshMeta();
    void loadRecentFiles();
  }, [refreshMeta, loadRecentFiles]);

  const imports = useExplorerImports({
    parentId: currentFolderId,
    onChanged: refreshLibraryData,
    strings,
  });

  // Reload recents (and tag counts) when a remote sync lands or any local
  // mutation occurs; `dataVersion` is the only signal for local repos.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    void loadRecentFiles();
  }, [
    loadRecentFiles,
    repositoryStatus.lastRemoteSyncAt,
    repositoryStatus.dataVersion,
  ]);

  const didMountMetaRefresh = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    if (!didMountMetaRefresh.current) {
      didMountMetaRefresh.current = true;
      return;
    }
    refreshMeta();
  }, [
    refreshMeta,
    repositoryStatus.lastRemoteSyncAt,
    repositoryStatus.dataVersion,
  ]);

  // Keep the breadcrumb trail in sync with the folder the explorer is showing.
  useEffect(() => {
    if (currentFolderId === null) {
      setBreadcrumbs([]);
      return;
    }
    let cancelled = false;
    repository
      .getFolderChain(currentFolderId)
      .then((chain) => {
        if (!cancelled) {
          setBreadcrumbs(chain);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Failed to load breadcrumbs', error, {
            currentFolderId,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentFolderId, repository]);

  const openGraph = useCallback(() => {
    tabController.openTab({ type: 'graph' }, strings.graph.title);
  }, [strings.graph.title, tabController]);

  const openSettings = useCallback(() => {
    tabController.openTab({ type: 'settings' }, strings.tabBar.settings);
  }, [strings.tabBar.settings, tabController]);

  const cycleSortMode = useCallback(() => {
    setSortMode(
      (prev) => SORT_MODES[(SORT_MODES.indexOf(prev) + 1) % SORT_MODES.length],
    );
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((mode) => (mode === 'tree' ? 'grid' : 'tree'));
  }, []);

  const toggleSearchMode = useCallback(() => {
    setSearchMode((mode) => (mode === 'semantic' ? 'lexical' : 'semantic'));
  }, []);

  // ExplorerTree.startNewFolder/startNewFile fire their onChanged (bound to
  // refreshMeta) internally after the write, so there's no need to refresh again.
  const handleNewFolder = useCallback(() => {
    void explorerRef.current?.startNewFolder();
  }, []);

  const handleNewFile = useCallback(
    (title: string, type: FileType) => {
      void explorerRef.current
        ?.startNewFile(title, type)
        .then(() => {
          trackEvent('note_created', { file_type: type });
        })
        .catch((error) => {
          logger.error('Failed to create file', error, { fileType: type });
          toast.error(strings.commandPalette.errors.createNote, {
            description: errorDescription(error),
          });
        });
    },
    [strings.commandPalette.errors.createNote],
  );

  const handleRefreshRepository = useCallback(() => {
    enqueueManualRepositoryRefresh(async () => {
      try {
        await repository.refresh();
        refreshLibraryData();
      } catch (error) {
        toast.error(strings.library.refreshRepository.failed, {
          description: errorDescription(error),
        });
      }
    });
  }, [
    refreshLibraryData,
    repository,
    strings.library.refreshRepository.failed,
  ]);

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
        <div className="fade-in-0 slide-in-from-bottom-2 animate-in duration-[150ms] ease-out">
          <div className="flex items-center justify-between gap-3">
            <h1
              className="font-extralight font-heading text-text-primary leading-[1.05]"
              style={{ fontSize: 'var(--fluid-display)' }}
            >
              {strings.library.title}
            </h1>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={openGraph}
                aria-label={strings.sidebar.graph}
                title={strings.sidebar.graph}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
              >
                <Network className="size-4" />
              </button>
              <button
                type="button"
                onClick={openSettings}
                aria-label={strings.tabBar.settings}
                title={strings.tabBar.settings}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
              >
                <Settings className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-6 max-w-xl">
            <BetaFeedbackBanner />
          </div>

          <section className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          onClick={toggleSearchMode}
                          aria-label={strings.library.semanticSearchLabel}
                          aria-pressed={searchMode === 'semantic'}
                          className={cn(
                            'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150',
                            searchMode === 'semantic'
                              ? 'bg-tag-active text-text-on-dark'
                              : 'text-text-muted hover:bg-surface hover:text-text-primary',
                          )}
                        >
                          <BrainCircuit className="size-3.5" />
                        </button>
                      }
                    />
                    <TooltipContent side="top">
                      {strings.library.semanticSearchLabel}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <h3 className="font-heading font-normal text-2xl leading-8">
                    <BreadcrumbCrumb
                      variant="root"
                      targetFolderId={null}
                      label={strings.library.explorer}
                      onNavigate={() => setCurrentFolderId(null)}
                      onMoved={() => {
                        setCurrentFolderId(null);
                        refreshLibraryData();
                      }}
                    />
                  </h3>
                  {breadcrumbs.length > 0 && (
                    <div className="flex min-w-0 items-center gap-1 text-sm text-text-muted">
                      <ChevronRight className="size-3.5 shrink-0" />
                      {breadcrumbs.map((crumb, i) => (
                        <span
                          key={crumb.id}
                          className="flex min-w-0 items-center gap-1"
                        >
                          {i > 0 && (
                            <ChevronRight className="size-3 shrink-0 text-text-muted" />
                          )}
                          <BreadcrumbCrumb
                            variant="crumb"
                            targetFolderId={crumb.id}
                            label={crumb.name}
                            isLast={i === breadcrumbs.length - 1}
                            onNavigate={() => setCurrentFolderId(crumb.id)}
                            onMoved={() => {
                              setCurrentFolderId(crumb.id);
                              refreshLibraryData();
                            }}
                          />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {refreshAvailable && (
                    <button
                      type="button"
                      onClick={handleRefreshRepository}
                      disabled={repositoryStatus.initializing || isRefreshing}
                      aria-label={strings.library.refreshRepository.label}
                      title={strings.library.refreshRepository.label}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150',
                        repositoryStatus.initializing || isRefreshing
                          ? 'cursor-default opacity-60'
                          : 'cursor-pointer hover:bg-hover-tint hover:text-text-primary',
                      )}
                    >
                      <RefreshCw
                        className={cn('size-4', isRefreshing && 'animate-spin')}
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
                    onImportFiles={imports.onImportFiles}
                    onImportGoodnotesZip={imports.onImportGoodnotesZip}
                    onImportObsidianVault={imports.onImportObsidianVault}
                    onImportWorkspaceJson={imports.onImportWorkspaceJson}
                    importDisabled={imports.importDisabled}
                  />
                </div>
              </div>

              <ExplorerTree
                ref={explorerRef}
                scrollRef={scrollRef}
                currentFolderId={currentFolderId}
                onNavigate={setCurrentFolderId}
                onChanged={refreshMeta}
                sortMode={sortMode}
                viewMode={viewMode}
                searchQuery={searchQuery}
                searchMode={searchMode}
                filterTags={filterTags}
              />
            </div>

            <div className="flex flex-col gap-8 lg:col-span-4">
              <div className="flex max-h-96 flex-col overflow-hidden rounded-2xl bg-card/50 ring-1 ring-border-subtle/70">
                <SidebarTags
                  variant="panel"
                  activeTags={activeTags}
                  onActiveTagsChanged={setActiveTags}
                  onTagsChanged={refreshLibraryData}
                  refreshKey={tagsRefreshKey}
                />
              </div>

              {recentFiles.length > 0 && (
                <section>
                  <h3 className="mb-4 font-heading font-normal text-2xl text-text-primary leading-8">
                    {strings.library.recentlyOpened}
                  </h3>

                  <div className="grid grid-cols-1 gap-4">
                    {recentFiles.map((file, i) => (
                      <div
                        key={file.id}
                        className="fade-in-0 slide-in-from-bottom-3 min-w-0 animate-in fill-mode-backwards duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]"
                        style={{ animationDelay: `${i * 80}ms` }}
                      >
                        <RecentCard
                          node={file}
                          featured={i === 0}
                          category={
                            strings.library.fileTypes[
                              file.fileType as keyof typeof strings.library.fileTypes
                            ] ?? file.fileType
                          }
                          time={formatRelativeTime(file.modifiedAt, locale, {
                            style: 'short',
                          })}
                          onClick={() =>
                            openNote(
                              tabController,
                              file,
                              file.name,
                              'recent_files',
                            )
                          }
                          onChanged={refreshLibraryData}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </section>
        </div>
      </main>

      <input
        ref={imports.storageInputRef}
        type="file"
        multiple
        accept={imports.storageInputAccept}
        className="hidden"
        onChange={imports.handleStorageInputChange}
      />
      <input
        ref={imports.goodnotesZipInputRef}
        type="file"
        accept={imports.goodnotesZipInputAccept}
        className="hidden"
        onChange={imports.handleGoodnotesZipInputChange}
      />
      {imports.importSource !== null && (
        <ImportDialog
          source={imports.importSource}
          onImported={imports.handleImportDialogDone}
          onClose={imports.closeImportSource}
        />
      )}
    </div>
  );
}

interface BreadcrumbCrumbProps {
  targetFolderId: string | null;
  label: string;
  /** 'root' is the h3-sized "Explorer" crumb; 'crumb' is an ancestor folder. */
  variant: 'root' | 'crumb';
  isLast?: boolean;
  onNavigate: () => void;
  /** Called after a dragged item is dropped and moved into this crumb. */
  onMoved: () => void;
}

/**
 * A single breadcrumb that doubles as a drop target: dragging a file/folder onto
 * it moves the item into that folder. Wraps the shared {@link useDropTarget} so
 * the breadcrumb reuses the same drag/drop plumbing as the explorer rows.
 */
function BreadcrumbCrumb({
  targetFolderId,
  label,
  variant,
  isLast = false,
  onNavigate,
  onMoved,
}: BreadcrumbCrumbProps) {
  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId,
    onMoved,
  });

  const className =
    variant === 'root'
      ? cn(
          '-mx-2 cursor-pointer rounded-lg px-2 py-0.5 transition-colors',
          dragOver
            ? 'bg-accent/15 text-accent-foreground'
            : 'text-text-primary hover:bg-hover-tint hover:text-text-secondary',
        )
      : cn(
          'truncate rounded px-1 transition-colors',
          dragOver
            ? 'bg-accent/15 text-accent-foreground ring-1 ring-accent/40'
            : isLast
              ? 'font-medium text-text-secondary'
              : 'cursor-pointer text-text-muted hover:text-text-secondary',
        );

  return (
    <button
      type="button"
      onClick={onNavigate}
      {...dropTargetProps}
      className={className}
    >
      {label}
    </button>
  );
}
