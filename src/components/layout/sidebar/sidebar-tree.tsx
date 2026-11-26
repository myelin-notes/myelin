import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { isApplePlatform } from '@myelin/shared/os';
import {
  createCanvasFromTemplate,
  fillTemplateFields,
} from '@/lib/note/templates';
import {
  type FileType,
  useRepository,
  useRepositoryStatus,
  type VFSFolderNode,
  type VFSNode,
  type VFSNodeId,
} from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { useNoteIndexStatus } from '@/lib/sync/repo/use-note-index-status';
import {
  compareExplorerNodes,
  ExplorerModel,
  type ExplorerSortMode,
  sortExplorerNodes,
} from '@/pages/library/explorer/explorer-model';
import { useDropTarget } from '@/pages/library/explorer/use-drop-target';
import { useExplorerSetupState } from '@/pages/library/explorer/use-explorer-setup-state';
import { pickAndImportTemplates } from '@/pages/library/import/template';
import { buildResultTree, type ResultTreeNode } from './result-tree';
import {
  SidebarFileRow,
  SidebarFolderRow,
  SidebarTemplatesPlaceholderRow,
} from './tree-rows';

const logger = new Logger('SidebarTree');
const SEARCH_DEBOUNCE_MS = 150;
const ROOT_KEY: string | null = null;
const NO_COLLAPSED_IDS: ReadonlySet<string> = new Set();

export type SortMode = ExplorerSortMode;

export interface SidebarTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
  startNewFile: (
    title: string,
    type: FileType,
    templateId?: VFSNodeId | null,
  ) => Promise<void>;
}

interface FlatResults {
  nodes: VFSNode[];
  /** Parent chains of every node in `nodes`, so the hierarchy can be rebuilt. */
  ancestors: VFSFolderNode[];
}

const EMPTY_RESULTS: FlatResults = { nodes: [], ancestors: [] };

interface Selection {
  ids: ReadonlySet<string>;
  /** Row a shift-click ranges from; the last plain- or modifier-clicked row. */
  anchor: string | null;
}

const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };

interface VisibleRow {
  node: VFSNode;
  depth: number;
  expanded: boolean;
}

function collectRows(
  nodes: VFSNode[],
  depth: number,
  expanded: ReadonlySet<string>,
  childrenMap: ReadonlyMap<string | null, VFSNode[]>,
  sortMode: SortMode,
): VisibleRow[] {
  return sortExplorerNodes(nodes, sortMode).flatMap((node) => {
    if (node.type !== 'folder') {
      return [{ node, depth, expanded: false }];
    }
    const isExpanded = expanded.has(node.id);
    return [
      { node, depth, expanded: isExpanded },
      ...(isExpanded
        ? collectRows(
            childrenMap.get(node.id) ?? [],
            depth + 1,
            expanded,
            childrenMap,
            sortMode,
          )
        : []),
    ];
  });
}

function collectResultRows(
  nodes: ResultTreeNode[],
  depth: number,
  collapsedIds: ReadonlySet<string>,
): VisibleRow[] {
  return nodes.flatMap(({ node, children }) => {
    if (node.type !== 'folder') {
      return [{ node, depth, expanded: false }];
    }
    const isExpanded = !collapsedIds.has(node.id);
    return [
      { node, depth, expanded: isExpanded },
      ...(isExpanded
        ? collectResultRows(children, depth + 1, collapsedIds)
        : []),
    ];
  });
}

interface SidebarTreeProps {
  ref?: React.Ref<SidebarTreeHandle>;
  sortMode: SortMode;
  searchQuery: string;
  filterTags: string[];
  onImport: (parentId: string) => void;
  importDisabled: boolean;
  /** Notified after a row edit (rename/move/delete) so the sidebar can refresh
   * its tag counts and file total alongside the tree. */
  onChanged?: () => void;
}

export function SidebarTree({
  ref,
  sortMode,
  searchQuery,
  filterTags,
  onImport,
  importDisabled,
  onChanged,
}: SidebarTreeProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const noteIndexStatus = useNoteIndexStatus();
  const explorer = useMemo(
    () =>
      new ExplorerModel(repository, (name, parentId, templateId) =>
        createCanvasFromTemplate(repository, name, parentId, templateId),
      ),
    [repository],
  );
  const setupState = useExplorerSetupState(repositoryStatus.config);
  const [childrenMap, setChildrenMap] = useState<Map<string | null, VFSNode[]>>(
    () => new Map(),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<{
    id: string;
    prefill: string | null;
  } | null>(null);
  const [searchResults, setSearchResults] =
    useState<FlatResults>(EMPTY_RESULTS);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const isFiltering = filterTags.length > 0;
  const isFlat = isSearching || isFiltering;
  // Not `=== 'ready'`: the credential check reads the keychain (~1s), and listing the local copy
  // doesn't need credentials.
  const ready = setupState !== 'setup-required';

  // Result folders start expanded; collapsing is remembered only for as long as
  // the query and tag filter stay put.
  const resultKey = `${trimmedQuery}\u0000${filterTags.join('\u0000')}`;
  const [collapsedResults, setCollapsedResults] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  }>({ key: resultKey, ids: NO_COLLAPSED_IDS });
  const collapsedIds =
    collapsedResults.key === resultKey
      ? collapsedResults.ids
      : NO_COLLAPSED_IDS;

  const loadFolder = useCallback(
    async (
      folderId: string | null,
      isCancelled: () => boolean = () => false,
    ) => {
      const nodes = await explorer.loadFolder(folderId);
      if (isCancelled()) {
        return;
      }
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.set(folderId, nodes);
        return next;
      });
    },
    [explorer],
  );

  const reload = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (!ready) {
        setChildrenMap(new Map());
        return;
      }
      const folderIds: (string | null)[] = [ROOT_KEY, ...expandedRef.current];
      await Promise.all(
        folderIds.map((id) =>
          loadFolder(id, isCancelled).catch((err) => {
            if (!isCancelled()) {
              logger.error('Failed to load folder', err, { folderId: id });
            }
          }),
        ),
      );
    },
    [loadFolder, ready],
  );

  const loadAncestors = useCallback(
    (nodes: VFSNode[]): Promise<VFSFolderNode[]> =>
      explorer.loadAncestors(nodes),
    [explorer],
  );

  const loadFlatResults = useCallback(async () => {
    if (!ready) {
      setSearchResults(EMPTY_RESULTS);
      return;
    }
    try {
      const result = await explorer.refresh({
        folderId: ROOT_KEY,
        searchQuery: trimmedQuery,
        filterTags,
      });
      if (!result) {
        return;
      }
      const ancestors = await loadAncestors(result.nodes);
      if (!explorer.isCurrent(result)) {
        return;
      }
      setSearchResults({
        nodes: result.nodes,
        ancestors,
      });
    } catch (err) {
      logger.error('Failed to load search results', err);
    }
  }, [filterTags, explorer, loadAncestors, ready, trimmedQuery]);

  // Not `lastRemoteSyncAt`: no-op remote checks advance it every 30s, and pulls that change data
  // bump `dataVersion`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    if (isFlat) {
      return;
    }
    let cancelled = false;
    void reload(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [isFlat, reload, repositoryStatus.dataVersion]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    if (!isFlat) {
      return;
    }
    if (!isSearching) {
      void loadFlatResults();
      return () => explorer.invalidatePendingRequests();
    }
    const timer = window.setTimeout(
      () => void loadFlatResults(),
      SEARCH_DEBOUNCE_MS,
    );
    return () => {
      window.clearTimeout(timer);
      explorer.invalidatePendingRequests();
    };
  }, [
    explorer,
    isFlat,
    isSearching,
    loadFlatResults,
    repositoryStatus.dataVersion,
    noteIndexStatus.revision,
  ]);

  const toggle = useCallback(
    (folderId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
          void loadFolder(folderId).catch((err) => {
            logger.error('Failed to expand folder', err, { folderId });
          });
        }
        return next;
      });
    },
    [loadFolder],
  );

  const startNewFolder = useCallback(
    async (parentId: string | null = ROOT_KEY) => {
      const node = await explorer.createFolder(
        parentId,
        strings.library.createNew.unnamedFolder,
      );
      setRenaming({ id: node.id, prefill: null });
      if (parentId !== null) {
        setExpanded((prev) => new Set(prev).add(parentId));
      }
      await loadFolder(parentId);
    },
    [explorer, loadFolder, strings.library.createNew.unnamedFolder],
  );

  const startNewFile = useCallback(
    async (
      title: string,
      type: FileType,
      parentId: string | null = ROOT_KEY,
      templateId?: VFSNodeId | null,
    ) => {
      const { node, renameValue } = await explorer.createFile(
        parentId,
        title,
        type,
        { templateId, locale },
      );
      setRenaming({ id: node.id, prefill: renameValue });
      if (parentId !== null) {
        setExpanded((prev) => new Set(prev).add(parentId));
      }
      await loadFolder(parentId);
    },
    [explorer, loadFolder, locale],
  );

  useImperativeHandle(
    ref,
    () => ({
      reload,
      startNewFolder,
      startNewFile: (title, type, templateId) =>
        startNewFile(title, type, ROOT_KEY, templateId),
    }),
    [reload, startNewFolder, startNewFile],
  );

  const notifyNested = useCallback(() => {
    void reload();
    onChanged?.();
  }, [reload, onChanged]);

  const notifyFlat = useCallback(() => {
    void loadFlatResults();
    onChanged?.();
  }, [loadFlatResults, onChanged]);

  // Keyed by row so a leave from the previous row can't clear the next row's enter.
  const [dropHover, setDropHover] = useState<{
    rowId: string;
    folderId: string | null;
  } | null>(null);

  const { dragOver: rootDragOver, dropTargetProps: rootDropProps } =
    useDropTarget({ targetFolderId: ROOT_KEY, onMoved: notifyNested });

  const toggleResultFolder = useCallback(
    (folderId: string) => {
      setCollapsedResults((prev) => {
        const ids = new Set(prev.key === resultKey ? prev.ids : []);
        if (!ids.delete(folderId)) {
          ids.add(folderId);
        }
        return { key: resultKey, ids };
      });
    },
    [resultKey],
  );

  const resultTree = useMemo(() => {
    if (!isFlat) {
      return null;
    }
    return buildResultTree(
      searchResults.nodes,
      searchResults.ancestors,
      (nodes) =>
        isSearching
          ? nodes.sort((a, b) => a.rank - b.rank)
          : nodes.sort((a, b) =>
              compareExplorerNodes(a.node, b.node, sortMode),
            ),
    );
  }, [isFlat, isSearching, searchResults, sortMode]);

  const visibleRows = useMemo(
    () =>
      isFlat
        ? collectResultRows(resultTree ?? [], 0, collapsedIds)
        : collectRows(
            childrenMap.get(ROOT_KEY) ?? [],
            0,
            expanded,
            childrenMap,
            sortMode,
          ),
    [childrenMap, collapsedIds, expanded, isFlat, resultTree, sortMode],
  );

  const finishNewRename = useCallback(
    (nodeId: string) => {
      if (renaming?.id === nodeId) {
        fillTemplateFields(repository, nodeId, locale).catch((error) => {
          logger.error('Failed to fill template fields', error, { nodeId });
        });
      }
      setRenaming((current) => (current?.id === nodeId ? null : current));
    },
    [locale, renaming?.id, repository],
  );

  // Only visible rows act; ids hidden by collapse/move/delete stay inert until shown again.
  // Descendants of a selected folder are dropped too, or moving the set would flatten them.
  const selectionIds = useMemo(() => {
    const ids: string[] = [];
    let selectedDepth = Infinity;
    for (const { node, depth } of visibleRows) {
      if (depth > selectedDepth) {
        continue;
      }
      selectedDepth = Infinity;
      if (selection.ids.has(node.id)) {
        ids.push(node.id);
        selectedDepth = depth;
      }
    }
    return ids;
  }, [selection.ids, visibleRows]);

  // Returns true when a modifier extended the selection, so the row skips its
  // default click action (open / expand).
  const selectRow = (nodeId: string, e: React.MouseEvent): boolean => {
    const toggling = isApplePlatform ? e.metaKey : e.ctrlKey;
    if (e.shiftKey) {
      const order = visibleRows.map((row) => row.node.id);
      const to = order.indexOf(nodeId);
      const from =
        selection.anchor === null ? -1 : order.indexOf(selection.anchor);
      const range =
        from === -1
          ? [nodeId]
          : order.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelection({
        ids: new Set(toggling ? [...selection.ids, ...range] : range),
        anchor: from === -1 ? nodeId : selection.anchor,
      });
      return true;
    }
    if (toggling) {
      const ids = new Set(selection.ids);
      if (!ids.delete(nodeId)) {
        ids.add(nodeId);
      }
      setSelection({ ids, anchor: nodeId });
      return true;
    }
    setSelection({ ids: new Set([nodeId]), anchor: nodeId });
    return false;
  };

  if (!ready) {
    return null;
  }

  const notify = isFlat ? notifyFlat : notifyNested;
  const importTemplates = () => {
    void pickAndImportTemplates(repository)
      .then((rootId) => {
        if (rootId === null) {
          return;
        }
        setExpanded((prev) => new Set(prev).add(rootId));
        return loadFolder(rootId).then(() => notify());
      })
      .catch((error) => {
        logger.error('Failed to import template', error);
        toast.error(strings.library.templates.importFailed);
      });
  };
  const templatesRootId =
    childrenMap.get(ROOT_KEY)?.find(isTemplatesRoot)?.id ?? null;
  const rows = visibleRows.map(({ node, depth, expanded: isExpanded }) => {
    const rowProps = {
      depth,
      isTemplate: node.parentId !== null && node.parentId === templatesRootId,
      autoRename: !isFlat && node.id === renaming?.id,
      renamePrefill: renaming?.prefill ?? undefined,
      onRenameEnd: finishNewRename,
      selected: selection.ids.has(node.id),
      selectionIds,
      // Not selectable: a multi-select must never carry the templates folder into Remove or Move.
      onSelect: (e: React.MouseEvent) =>
        !isTemplatesRoot(node) && selectRow(node.id, e),
      onChanged: notify,
      onDropHover: (over: boolean) => {
        const folderId = node.type === 'folder' ? node.id : node.parentId;
        setDropHover((prev) =>
          over
            ? { rowId: node.id, folderId }
            : prev?.rowId === node.id
              ? null
              : prev,
        );
      },
    };
    if (node.type === 'folder') {
      return (
        <SidebarFolderRow
          key={node.id}
          node={node}
          expanded={isExpanded}
          dropHighlighted={dropHover?.folderId === node.id}
          onNewFolder={() => {
            void startNewFolder(node.id).catch((error) => {
              logger.error('Failed to create folder', error);
            });
          }}
          onNewFile={(title, type, templateId) => {
            void startNewFile(title, type, node.id, templateId).catch(
              (error) => {
                logger.error('Failed to create canvas', error);
              },
            );
          }}
          importDisabled={importDisabled}
          onImportTemplate={importTemplates}
          onImport={() => {
            setExpanded((prev) => new Set(prev).add(node.id));
            onImport(node.id);
          }}
          onToggle={() =>
            isFlat ? toggleResultFolder(node.id) : toggle(node.id)
          }
          {...rowProps}
        />
      );
    }
    return <SidebarFileRow key={node.id} node={node} {...rowProps} />;
  });
  const emptyMessage = isSearching
    ? strings.library.explorerTree.emptySearch
    : isFiltering
      ? strings.library.explorerTree.emptyFilter
      : strings.library.explorerTree.emptyDefault;

  return (
    <div
      className={cn(
        'flex min-h-full flex-col gap-0.5 rounded-md transition-colors duration-150',
        // Other rows ignore clicks while one is renaming; see ExplorerTree.
        '[&:has(input)_button:not(:has(input))]:pointer-events-none',
        !isFlat && rootDragOver && 'bg-accent/10 ring-1 ring-accent/30',
      )}
      {...(isFlat ? {} : rootDropProps)}
    >
      {!isFlat && childrenMap.has(ROOT_KEY) && templatesRootId === null && (
        <SidebarTemplatesPlaceholderRow
          onOpen={() => {
            void repository
              .ensureTemplatesRoot()
              .then((id) => {
                setExpanded((prev) => new Set(prev).add(id));
                return reload();
              })
              .catch((error) => {
                logger.error('Failed to create templates folder', error);
              });
          }}
          onImportTemplate={importTemplates}
          onNewTemplate={() => {
            void repository
              .ensureTemplatesRoot()
              .then((id) =>
                startNewFile(
                  strings.library.createNew.untitledCanvas,
                  'mcanvas',
                  id,
                  null,
                ).then(() => reload()),
              )
              .catch((error) => {
                logger.error('Failed to create template', error);
              });
          }}
        />
      )}
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-text-muted text-xs italic">
          {emptyMessage}
        </p>
      ) : (
        rows
      )}
    </div>
  );
}
