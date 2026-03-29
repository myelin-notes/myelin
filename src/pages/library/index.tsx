import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowDownZA,
  CalendarPlus,
  ChevronRight,
  Clock,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/layout/sidebar';
import {
  FileSystem,
  type VFSFileNode,
  type VFSFolderNode,
} from '@/lib/utils/file-system';
import { CreateNewDropdown } from './create-new-dropdown';
import {
  ExplorerTree,
  type ExplorerTreeHandle,
  type SortMode,
} from './explorer/explorer-tree';
import { RecentCard } from './recent-card';
import { SemanticTags } from './semantic-tags';

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'Just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const fileTypeLabel: Record<string, string> = {
  mcanvas: 'Canvas',
};

export function LibraryPage() {
  const navigate = useNavigate();
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<VFSFolderNode[]>([]);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [breadcrumbDragIdx, setBreadcrumbDragIdx] = useState<number | null>(
    null,
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [recentFiles, setRecentFiles] = useState<VFSFileNode[]>([]);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTagsArr = useMemo(() => [...activeTags], [activeTags]);
  const [searchQuery, setSearchQuery] = useState('');
  const sortModes: SortMode[] = [
    'name-asc',
    'name-desc',
    'modified',
    'created',
  ];
  const [sortMode, setSortMode] = useState<SortMode>('name-asc');
  const cycleSortMode = useCallback(() => {
    setSortMode(
      (prev) => sortModes[(sortModes.indexOf(prev) + 1) % sortModes.length],
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: sortModes is a static array
  }, [sortModes]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    explorerRef.current?.reload();
  }, []);

  useEffect(() => {
    FileSystem.getManifest().then((manifest) => {
      setRecentFiles(FileSystem.getRecentFiles(manifest, 3));
    });
  }, []);

  // Update breadcrumbs when folder changes
  useEffect(() => {
    if (currentFolderId === null) {
      setBreadcrumbs([]);
      return;
    }
    FileSystem.getManifest().then((manifest) => {
      setBreadcrumbs(FileSystem.getFolderChain(manifest, currentFolderId));
    });
  }, [currentFolderId]);

  const clearDragTimer = useCallback(() => {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  }, []);

  const handleBreadcrumbDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string | null) => {
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
        await FileSystem.moveNode(nodeId, targetFolderId);
        setCurrentFolderId(targetFolderId);
        triggerRefresh();
      } catch (err) {
        console.error('Failed to move item:', err);
      }
    },
    [clearDragTimer, triggerRefresh],
  );

  const makeBreadcrumbDragHandlers = useCallback(
    (targetFolderId: string | null, idx: number) => ({
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
        dragTimerRef.current = setTimeout(() => {
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
    }),
    [clearDragTimer, handleBreadcrumbDrop],
  );

  return (
    <div className="relative flex h-full w-full bg-page">
      <Sidebar />

      <main className="ml-64 flex-1 overflow-y-auto px-12 pt-12 pb-12">
        <h1 className="font-extralight font-heading text-5xl text-text-primary leading-[48px]">
          Digital Library
        </h1>

        {/* Recently Opened */}
        {recentFiles.length > 0 && (
          <section className="mt-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="font-heading font-normal text-2xl text-text-primary leading-8">
                Recently Opened
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {recentFiles.map((file, i) => (
                <RecentCard
                  key={file.id}
                  category={fileTypeLabel[file.fileType] ?? file.fileType}
                  time={formatRelativeTime(file.modifiedAt)}
                  title={file.name}
                  tags={file.tags}
                  featured={i === 0}
                  onClick={() => navigate(`/${file.fileType}/${file.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Explorer + Tags */}
        <section className="mt-12 grid grid-cols-12 gap-12">
          <div className="col-span-8 flex flex-col gap-8">
            <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-1.5 transition-colors hover:bg-hover-tint">
              <Search className="size-3.5 shrink-0 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search studio..."
                className="w-full bg-transparent px-3 py-2 font-medium text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setCurrentFolderId(null);
                    }
                  }}
                  onClick={() => setCurrentFolderId(null)}
                  className={`cursor-pointer font-heading font-normal text-2xl leading-8 transition-colors ${
                    breadcrumbDragIdx === -1
                      ? 'text-accent-foreground'
                      : 'text-text-primary hover:text-text-secondary'
                  }`}
                  {...makeBreadcrumbDragHandlers(null, -1)}
                >
                  Explorer
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
              <div className="flex items-center gap-3">
                <button
                  onClick={cycleSortMode}
                  title={`Sort: ${sortMode}`}
                  className="cursor-pointer text-text-secondary transition-colors hover:text-text-primary"
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
                <CreateNewDropdown
                  onNewFolder={() => explorerRef.current?.startNewFolder()}
                  onNewFile={(title, type) =>
                    explorerRef.current?.startNewFile(title, type)
                  }
                />
              </div>
            </div>

            <ExplorerTree
              ref={explorerRef}
              currentFolderId={currentFolderId}
              onNavigate={setCurrentFolderId}
              onTagsChanged={() => setRefreshKey((k) => k + 1)}
              sortMode={sortMode}
              searchQuery={searchQuery}
              filterTags={filterTagsArr}
            />
          </div>

          <div className="col-span-4">
            <SemanticTags
              refreshKey={refreshKey}
              activeTags={activeTags}
              onActiveTagsChanged={(tags) => {
                setActiveTags(tags);
                // Force explorer reload when tags change
                setTimeout(() => explorerRef.current?.reload(), 0);
              }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
