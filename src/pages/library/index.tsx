import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { ArrowDownAZ, ArrowDownZA, Clock, CalendarPlus, Search, ChevronRight } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { RecentCard } from "./recent-card";
import { ExplorerTree, ExplorerTreeHandle, SortMode } from "./explorer/explorer-tree";
import { SemanticTags } from "./semantic-tags";
import { CreateNewDropdown } from "./create-new-dropdown";
import { FileSystem, VFSFolderNode } from "@/lib/utils/file-system";


const recentItems = [
  {
    category: "Draft",
    time: "2h ago",
    title: "The Architecture of Silence",
    excerpt:
      "Exploring the spatial dynamics of monastic retreats in the modern\u2026",
    tags: ["Architecture"],
    featured: true,
  },
  {
    category: "Research",
    time: "Yesterday",
    title: "Phenomenology of Tools",
    excerpt:
      "How physical interfaces dictate the cognitive flow of digital creators.",
    tags: ["Philosophy", "Systems"],
  },
  {
    category: "Note",
    time: "3 days ago",
    title: "Brutalist Typography",
    excerpt:
      "Collecting specimens of high-contrast sans-serifs in late 70s\u2026",
    tags: ["Design"],
  },
];

export function LibraryPage() {
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<VFSFolderNode[]>([]);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [breadcrumbDragIdx, setBreadcrumbDragIdx] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTagsArr = useMemo(() => [...activeTags], [activeTags]);
  const [searchQuery, setSearchQuery] = useState("");
  const sortModes: SortMode[] = ["name-asc", "name-desc", "modified", "created"];
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const cycleSortMode = useCallback(() => {
    setSortMode((prev) => sortModes[(sortModes.indexOf(prev) + 1) % sortModes.length]);
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    explorerRef.current?.reload();
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

      const raw = e.dataTransfer.getData("application/myelin-item");
      if (!raw) return;

      const { nodeId } = JSON.parse(raw) as { nodeId: string };

      try {
        await FileSystem.moveNode(nodeId, targetFolderId);
        setCurrentFolderId(targetFolderId);
        triggerRefresh();
      } catch (err) {
        console.error("Failed to move item:", err);
      }
    },
    [clearDragTimer, triggerRefresh]
  );

  const makeBreadcrumbDragHandlers = useCallback(
    (targetFolderId: string | null, idx: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes("application/myelin-item")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      },
      onDragEnter: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes("application/myelin-item")) return;
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
    [clearDragTimer, handleBreadcrumbDrop]
  );

  return (
    <div className="relative flex h-full w-full bg-page">
      <Sidebar />

      <main className="ml-64 flex-1 overflow-y-auto px-12 pt-12 pb-12">
        <h1 className="font-heading text-5xl font-extralight leading-[48px] text-text-primary">
          Digital Library
        </h1>

        {/* Recently Opened */}
        <section className="mt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-heading text-2xl font-normal leading-8 text-text-primary">
              Recently Opened
            </h3>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {recentItems.map((item) => (
              <RecentCard key={item.title} {...item} />
            ))}
          </div>
        </section>

        {/* Explorer + Tags */}
        <section className="mt-12 grid grid-cols-12 gap-12">
          <div className="col-span-8 flex flex-col gap-8">
            <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-1.5 transition-colors hover:bg-black/5">
              <Search className="size-3.5 text-text-muted shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search studio..."
                className="w-full bg-transparent py-2 px-3 text-sm font-medium text-text-primary placeholder:text-text-muted outline-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3
                  onClick={() => setCurrentFolderId(null)}
                  className={`font-heading text-2xl font-normal leading-8 cursor-pointer transition-colors ${
                    breadcrumbDragIdx === -1
                      ? "text-accent-foreground"
                      : "text-text-primary hover:text-text-secondary"
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
                        <span key={crumb.id} className="flex items-center gap-1">
                          {i > 0 && <ChevronRight className="size-3 shrink-0 text-text-muted" />}
                          <button
                            onClick={() => setCurrentFolderId(crumb.id)}
                            className={`rounded px-1 transition-colors ${
                              isDragTarget
                                ? "bg-accent/15 text-accent-foreground ring-1 ring-accent/40"
                                : isLast
                                  ? "text-text-secondary font-medium"
                                  : "text-text-muted hover:text-text-secondary cursor-pointer"
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
                  className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                >
                  {sortMode === "name-asc" && <ArrowDownAZ className="size-4" />}
                  {sortMode === "name-desc" && <ArrowDownZA className="size-4" />}
                  {sortMode === "modified" && <Clock className="size-4" />}
                  {sortMode === "created" && <CalendarPlus className="size-4" />}
                </button>
                <CreateNewDropdown
                  onNewFolder={() => explorerRef.current?.startNewFolder()}
                  onNewFile={(title, type) => explorerRef.current?.startNewFile(title, type)}
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
