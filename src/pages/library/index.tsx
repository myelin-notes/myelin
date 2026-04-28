import {
  type ChangeEvent,
  useCallback,
  useEffect,
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
  Search,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sidebar } from '@/components/layout/sidebar';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note-navigation';
import {
  useRepository,
  type VFSFileNode,
  type VFSFolderNode,
} from '@/lib/sync';
import { UserPrefs } from '@/lib/user-prefs';
import { CreateNewDropdown } from './create-new-dropdown';
import {
  ExplorerTree,
  type ExplorerTreeHandle,
  type SortMode,
  type ViewMode,
} from './explorer/explorer-tree';
import {
  importStorageFile,
  isStorageFile,
  STORAGE_FILE_ACCEPT,
} from './import-files';
import {
  importMarkdownFile,
  isMarkdownFile,
  MARKDOWN_FILE_ACCEPT,
} from './import-markdown';
import { RecentCard } from './recent-card';
import { SemanticTags } from './semantic-tags';

const logger = new Logger('LibraryPage');
const LIBRARY_IMPORT_ACCEPT = `${MARKDOWN_FILE_ACCEPT},${STORAGE_FILE_ACCEPT}`;

export function LibraryPage() {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const navigate = useNavigate();
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<VFSFolderNode[]>([]);
  const dragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [breadcrumbDragIdx, setBreadcrumbDragIdx] = useState<number | null>(
    null,
  );
  const [semanticTagsVersion, setSemanticTagsVersion] = useState(0);
  const [recentFiles, setRecentFiles] = useState<VFSFileNode[]>([]);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const filterTagsArr = [...activeTags];
  const [searchQuery, setSearchQuery] = useState('');
  const sortModes: SortMode[] = [
    'name-asc',
    'name-desc',
    'modified',
    'created',
  ];
  const [sortMode, setSortMode] = useState<SortMode>('name-asc');
  const [isImportingFiles, setIsImportingFiles] = useState(false);
  const cycleSortMode = () => {
    setSortMode(
      (prev) => sortModes[(sortModes.indexOf(prev) + 1) % sortModes.length],
    );
  };
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    UserPrefs.get('explorerViewMode'),
  );
  useEffect(() => UserPrefs.subscribe('explorerViewMode', setViewMode), []);
  const toggleViewMode = () => {
    UserPrefs.set('explorerViewMode', viewMode === 'tree' ? 'grid' : 'tree');
  };

  const loadRecentFiles = useCallback(async () => {
    try {
      setRecentFiles(await repository.getRecentFiles(3));
    } catch (error) {
      logger.error('Failed to load recent files', error);
    }
  }, [repository]);

  const triggerRefresh = useCallback(() => {
    setSemanticTagsVersion((version) => version + 1);
    explorerRef.current?.reload();
    void loadRecentFiles();
  }, [loadRecentFiles]);

  const handleImportStorageFiles = async (files: File[]) => {
    const supportedFiles = files.filter(
      (file) => isMarkdownFile(file) || isStorageFile(file),
    );
    if (supportedFiles.length === 0) {
      toast.error(strings.library.importFiles.unsupportedFile);
      return;
    }

    setIsImportingFiles(true);

    try {
      const importedMarkdownIds: string[] = [];
      for (const file of supportedFiles) {
        if (isMarkdownFile(file)) {
          importedMarkdownIds.push(
            await importMarkdownFile({
              file,
              repository,
              parentId: currentFolderId,
              fallbackTitle: strings.library.createNew.untitledCanvas,
            }),
          );
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

  const handleStorageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0 || isImportingFiles) {
      return;
    }
    void handleImportStorageFiles(files);
  };

  useEffect(() => {
    void loadRecentFiles();
  }, [loadRecentFiles]);

  // Update breadcrumbs when folder changes
  useEffect(() => {
    if (currentFolderId === null) {
      setBreadcrumbs([]);
      return;
    }
    repository
      .getFolderChain(currentFolderId)
      .then(setBreadcrumbs)
      .catch((error) => {
        logger.error('Failed to load breadcrumbs', error, { currentFolderId });
      });
  }, [currentFolderId, repository]);

  const clearDragTimer = () => {
    if (dragTimerRef.current) {
      clearTimeout(dragTimerRef.current);
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
  });

  return (
    <div className="relative flex h-full w-full bg-page">
      <a href="#library-main" data-skip-link className="skip-link">
        {strings.library.title}
      </a>
      <Sidebar />

      <main
        id="library-main"
        className="ml-16 flex-1 overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:ml-64 md:px-10 md:pt-12 lg:px-12"
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
                      onClick={() => openNote(navigate, file)}
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          )}

          {/* Explorer + Tags */}
          <section className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="flex flex-col gap-8 lg:col-span-8">
              <div className="group flex items-center gap-1 rounded-[1.1rem] bg-card/75 px-3 py-2 transition-all duration-200 focus-within:bg-card focus-within:shadow-ambient hover:bg-card">
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
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text-primary"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
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
                    {strings.library.explorer}
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
                    aria-label={strings.library.sortLabel(
                      strings.library.sortModes[sortMode],
                    )}
                    title={strings.library.sortLabel(
                      strings.library.sortModes[sortMode],
                    )}
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
                  <button
                    onClick={toggleViewMode}
                    aria-label={strings.library.viewModeLabel(
                      strings.library.viewModes[viewMode],
                    )}
                    title={strings.library.viewModeLabel(
                      strings.library.viewModes[viewMode],
                    )}
                    className="cursor-pointer text-text-secondary transition-colors hover:text-text-primary"
                  >
                    {viewMode === 'tree' ? (
                      <List className="size-4" />
                    ) : (
                      <LayoutGrid className="size-4" />
                    )}
                  </button>
                  <CreateNewDropdown
                    onNewFolder={() => explorerRef.current?.startNewFolder()}
                    onNewFile={(title, type) =>
                      explorerRef.current?.startNewFile(title, type)
                    }
                    onImportFiles={() => importInputRef.current?.click()}
                  />
                  <input
                    ref={importInputRef}
                    type="file"
                    multiple
                    accept={LIBRARY_IMPORT_ACCEPT}
                    className="hidden"
                    onChange={handleStorageInputChange}
                  />
                </div>
              </div>

              <ExplorerTree
                ref={explorerRef}
                currentFolderId={currentFolderId}
                onNavigate={setCurrentFolderId}
                onTagsChanged={() =>
                  setSemanticTagsVersion((version) => version + 1)
                }
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
                onActiveTagsChanged={(tags) => {
                  setActiveTags(tags);
                  // Force explorer reload when tags change
                  setTimeout(() => explorerRef.current?.reload(), 0);
                }}
              />
            </div>
          </section>
        </motion.div>
      </main>
    </div>
  );
}
