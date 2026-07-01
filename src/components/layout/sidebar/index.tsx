import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  CalendarPlus,
  Clock,
  Network,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { isMac, isWindows, TRAFFIC_LIGHT_INSET_CLASS } from '@/lib/platform';
import { type FileType, useRepository, useRepositoryStatus } from '@/lib/sync';
import {
  enqueueManualRepositoryRefresh,
  useManualRepositoryRefreshAvailable,
  useManualRepositoryRefreshPending,
} from '@/lib/sync/manual-refresh';
import { useTabController } from '@/lib/tabs/context';
import { cn } from '@/lib/utils';
import { CreateNewDropdown } from '@/pages/library/create-new-dropdown';
import { ImportDialog } from '@/pages/library/import/dialog';
import { useSidebar } from './context';
import { SidebarTags } from './sidebar-tags';
import {
  type SearchMode,
  SidebarTree,
  type SidebarTreeHandle,
  type SortMode,
} from './sidebar-tree';
import { useExplorerImports } from './use-explorer-imports';

const logger = new Logger('Sidebar');
const SORT_MODES: SortMode[] = ['name-asc', 'name-desc', 'modified', 'created'];

function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Sidebar() {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const tabController = useTabController();
  const { width } = useSidebar();
  const treeRef = useRef<SidebarTreeHandle>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('lexical');
  const [sortMode, setSortMode] = useState<SortMode>('name-asc');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTags = useMemo(() => [...activeTags], [activeTags]);
  const [tagsRefreshKey, setTagsRefreshKey] = useState(0);

  const isRefreshing = useManualRepositoryRefreshPending();
  const refreshAvailable = useManualRepositoryRefreshAvailable(
    repositoryStatus.config,
    repositoryStatus.initializing,
  );

  const refreshMeta = useCallback(() => {
    setTagsRefreshKey((key) => key + 1);
  }, []);

  const refreshAfterImport = useCallback(() => {
    void treeRef.current?.reload();
    refreshMeta();
  }, [refreshMeta]);

  const imports = useExplorerImports({
    parentId: null,
    onChanged: refreshAfterImport,
    strings,
  });

  // Refresh tag counts when a remote sync lands or any local
  // repository mutation occurs (create/rename/delete/move/tag), including
  // changes made outside the sidebar such as the tab bar's new-tab button.
  // `dataVersion` is the only refresh signal for local repos, where
  // `lastRemoteSyncAt` stays null. Skip the initial render — the tags list
  // already loads on mount.
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

  const toggleSearchMode = useCallback(() => {
    setSearchMode((mode) => (mode === 'semantic' ? 'lexical' : 'semantic'));
  }, []);

  const handleNewFolder = useCallback(() => {
    void treeRef.current?.startNewFolder().then(refreshMeta);
  }, [refreshMeta]);

  const handleNewFile = useCallback(
    (title: string, type: FileType) => {
      void treeRef.current
        ?.startNewFile(title, type)
        .then(() => {
          trackEvent('note_created', { file_type: type });
          refreshMeta();
        })
        .catch((error) => {
          logger.error('Failed to create file', error, { fileType: type });
          toast.error(strings.commandPalette.errors.createNote, {
            description: errorDescription(error),
          });
        });
    },
    [refreshMeta, strings.commandPalette.errors.createNote],
  );

  const handleRefreshRepository = useCallback(() => {
    if (!refreshAvailable || repositoryStatus.initializing) {
      return;
    }
    enqueueManualRepositoryRefresh(async () => {
      try {
        await repository.refresh();
        void treeRef.current?.reload();
        refreshMeta();
      } catch (error) {
        toast.error(strings.library.refreshRepository.failed, {
          description: errorDescription(error),
        });
      }
    });
  }, [
    refreshAvailable,
    refreshMeta,
    repository,
    repositoryStatus.initializing,
    strings.library.refreshRepository.failed,
  ]);

  return (
    <aside
      style={{ width }}
      className="flex h-full shrink-0 flex-col bg-surface"
    >
      <header
        data-tauri-drag-region
        className={cn(
          'flex h-11 shrink-0 items-center gap-0.5 px-2',
          // macOS right-aligns the buttons since the traffic lights hold the
          // left; Windows has no lights, so center them instead of stranding
          // them in the corner.
          isWindows ? 'justify-center' : 'justify-end',
          isMac && TRAFFIC_LIGHT_INSET_CLASS,
        )}
      >
        <button
          type="button"
          onClick={openGraph}
          aria-label={strings.sidebar.graph}
          title={strings.sidebar.graph}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
        >
          <Network className="size-4" />
        </button>
        <button
          type="button"
          onClick={openSettings}
          aria-label={strings.tabBar.settings}
          title={strings.tabBar.settings}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
        >
          <Settings className="size-4" />
        </button>
      </header>

      <div className="px-2 pb-2">
        <div className="group flex items-center gap-1 rounded-xl bg-card/75 px-1.5 py-1 ring-1 ring-border-subtle/70 transition-colors duration-150 focus-within:bg-card focus-within:ring-accent-dark/15 hover:bg-card">
          <span className="flex size-6 shrink-0 items-center justify-center text-text-muted group-focus-within:text-accent-dark">
            <Search className="size-3.5" />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={strings.sidebar.searchPlaceholder}
            aria-label={strings.sidebar.searchPlaceholder}
            className="w-full min-w-0 bg-transparent py-1 font-normal text-[13px] text-text-primary outline-none placeholder:text-text-muted"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={strings.common.clear}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleSearchMode}
            aria-pressed={searchMode === 'semantic'}
            aria-label={strings.library.semanticSearchLabel}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 font-medium text-[11px] transition-colors duration-150',
              searchMode === 'semantic'
                ? 'bg-tag-active text-text-on-dark'
                : 'bg-surface text-text-muted ring-1 ring-border-subtle/70 hover:text-text-primary',
            )}
          >
            <Search className="size-3" />
            {searchMode === 'semantic'
              ? strings.sidebar.searchModeSemantic
              : strings.sidebar.searchModeText}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-1 px-3 py-1">
        <span className="font-bold text-[11px] text-text-muted uppercase tracking-[0.08em]">
          {strings.sidebar.explorer}
        </span>
        <div className="flex items-center gap-0.5">
          {refreshAvailable && (
            <button
              type="button"
              onClick={handleRefreshRepository}
              disabled={repositoryStatus.initializing || isRefreshing}
              aria-label={strings.library.refreshRepository.label}
              title={strings.library.refreshRepository.label}
              className={cn(
                'flex size-6 items-center justify-center rounded-md text-text-secondary transition-colors duration-150',
                repositoryStatus.initializing || isRefreshing
                  ? 'cursor-default opacity-60'
                  : 'cursor-pointer hover:bg-hover-tint hover:text-text-primary',
              )}
            >
              <RefreshCw
                className={cn('size-3.5', isRefreshing && 'animate-spin')}
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
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
          >
            {sortMode === 'name-asc' && <ArrowDownAZ className="size-3.5" />}
            {sortMode === 'name-desc' && <ArrowDownZA className="size-3.5" />}
            {sortMode === 'modified' && <Clock className="size-3.5" />}
            {sortMode === 'created' && <CalendarPlus className="size-3.5" />}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <SidebarTree
          ref={treeRef}
          sortMode={sortMode}
          searchQuery={searchQuery}
          searchMode={searchMode}
          filterTags={filterTags}
          onChanged={refreshMeta}
        />
      </div>

      <SidebarTags
        activeTags={activeTags}
        onActiveTagsChanged={setActiveTags}
        onTagsChanged={refreshAfterImport}
        refreshKey={tagsRefreshKey}
      />

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
    </aside>
  );
}
