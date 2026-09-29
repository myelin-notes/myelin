import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  CalendarPlus,
  Clock,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { TAB_BAR_HEIGHT_CLASS } from '@myelin/shared/os';
import { errorDescription } from '@/components/command-palette/utils';
import { trackEvent } from '@/lib/analytics';
import { type FileType, useRepository, useRepositoryStatus } from '@/lib/sync';
import {
  enqueueManualRepositoryRefresh,
  useManualRepositoryRefreshAvailable,
  useManualRepositoryRefreshPending,
} from '@/lib/sync/manual-refresh';
import { useNoteIndexStatus } from '@/lib/sync/repo/use-note-index-status';
import { CreateNewDropdown } from '@/pages/library/create-new-dropdown';
import { ImportHost } from '@/pages/library/import/import-host';
import { useImports } from '@/pages/library/import/use-imports';
import { useSidebar } from './context';
import { SidebarTags } from './sidebar-tags';
import {
  SidebarTree,
  type SidebarTreeHandle,
  type SortMode,
} from './sidebar-tree';

const logger = new Logger('Sidebar');
const SORT_MODES: SortMode[] = ['name-asc', 'name-desc', 'modified', 'created'];

export function Sidebar({ fill = false }: { fill?: boolean } = {}) {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const noteIndexStatus = useNoteIndexStatus();
  const { width } = useSidebar();
  const treeRef = useRef<SidebarTreeHandle>(null);

  const [searchQuery, setSearchQuery] = useState('');
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

  const [importParentId, setImportParentId] = useState<string | null>(null);
  const imports = useImports({
    parentId: importParentId,
    onChanged: refreshAfterImport,
  });

  // `dataVersion` is the only refresh signal for local repos, where `lastRemoteSyncAt` stays null.
  // Skip the initial render — the tags list already loads on mount.
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

  const cycleSortMode = useCallback(() => {
    setSortMode(
      (prev) => SORT_MODES[(SORT_MODES.indexOf(prev) + 1) % SORT_MODES.length],
    );
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
      style={fill ? undefined : { width }}
      className={cn(
        'flex h-full shrink-0 flex-col bg-surface',
        fill && 'w-full',
      )}
    >
      <header
        data-tauri-drag-region
        className={cn('shrink-0', TAB_BAR_HEIGHT_CLASS)}
      />

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
        </div>
        {searchQuery.trim() &&
          noteIndexStatus.active &&
          (noteIndexStatus.scanning ||
            noteIndexStatus.indexed + noteIndexStatus.failed <
              noteIndexStatus.total) && (
            <div className="px-2 pt-1 text-[11px] text-text-muted">
              {noteIndexStatus.scanning
                ? strings.library.explorerTree.preparingIndex
                : strings.library.explorerTree.indexingNotes(
                    noteIndexStatus.indexed,
                    noteIndexStatus.total,
                  )}
            </div>
          )}
        {searchQuery.trim() && noteIndexStatus.failed > 0 && (
          <div className="px-2 pt-1 text-[11px] text-text-muted">
            {strings.library.explorerTree.indexingFailed(
              noteIndexStatus.failed,
            )}
          </div>
        )}
        {searchQuery.trim() && noteIndexStatus.loadError && (
          <div className="px-2 pt-1 text-[11px] text-text-muted">
            {strings.library.explorerTree.indexingUnavailable}
          </div>
        )}
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
            onImport={() => {
              setImportParentId(null);
              imports.openPicker();
            }}
            importDisabled={imports.importDisabled}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <SidebarTree
          ref={treeRef}
          sortMode={sortMode}
          searchQuery={searchQuery}
          filterTags={filterTags}
          importDisabled={imports.importDisabled}
          onImport={(parentId) => {
            setImportParentId(parentId);
            imports.openPicker();
          }}
          onChanged={refreshMeta}
        />
      </div>

      <SidebarTags
        activeTags={activeTags}
        onActiveTagsChanged={setActiveTags}
        onTagsChanged={refreshAfterImport}
        refreshKey={tagsRefreshKey}
      />

      <ImportHost {...imports.hostProps} />
    </aside>
  );
}
