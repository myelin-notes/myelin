import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note/navigation';
import { type RepositoryNoteGraph, useRepository } from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { cn } from '@/lib/utils';
import { buildNoteGraph } from '@/pages/graph/build-note-graph';
import { GraphView } from './graph-view';
import { scopeNoteGraphSource } from './scope-note-graph';
import type { SearchMode } from './types';
import type { RepositorySetupState } from './use-repository-setup-state';

const logger = new Logger('GraphPane');

interface GraphPaneProps {
  /** Ids of the files in the current lens/selection — the graph's scope. */
  fileIds: string[];
  filesLoading: boolean;
  setupState: RepositorySetupState;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  /** Bumped by the parent to refetch the note graph after changes. */
  refreshKey: number;
  activityLabel: string | null;
  refreshAvailable: boolean;
  refreshing: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
}

export function GraphPane({
  fileIds,
  filesLoading,
  setupState,
  searchQuery,
  onSearchQueryChange,
  searchMode,
  onSearchModeChange,
  refreshKey,
  activityLabel,
  refreshAvailable,
  refreshing,
  refreshDisabled,
  onRefresh,
}: GraphPaneProps) {
  const strings = useMessages();
  const repository = useRepository();
  const tabController = useTabController();
  const [source, setSource] = useState<RepositoryNoteGraph | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a refetch trigger, not read in the body
  useEffect(() => {
    if (setupState !== 'ready') {
      setSource(null);
      setSourceLoading(false);
      return;
    }
    let cancelled = false;
    setSourceLoading(true);
    repository
      .getNoteGraph()
      .then((next) => {
        if (!cancelled) {
          setSource(next);
          setSourceLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Failed to load note graph', error);
          setSourceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, setupState, refreshKey]);

  // fileIdsKey is the stable string identity of the fileIds array.
  const fileIdsKey = fileIds.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: fileIdsKey mirrors fileIds
  const scopedGraph = useMemo(() => {
    if (!source) {
      return null;
    }
    return buildNoteGraph(scopeNoteGraphSource(source, new Set(fileIds)));
  }, [source, fileIdsKey]);

  const loading = filesLoading || sourceLoading;
  const isEmpty = !loading && (!scopedGraph || scopedGraph.nodes.length === 0);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-page">
      <header className="flex items-center gap-2 border-border-subtle/60 border-b px-6 py-4">
        <div className="group flex flex-1 items-center gap-1 rounded-xl bg-card/75 px-2.5 py-1.5 ring-1 ring-border-subtle/70 transition-all duration-200 focus-within:bg-card focus-within:shadow-ambient focus-within:ring-accent-dark/15 hover:bg-card">
          <span className="flex size-7 shrink-0 items-center justify-center text-text-muted transition-colors duration-200 group-focus-within:text-accent-dark">
            <Search className="size-3.5" />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder={strings.library.searchPlaceholder}
            aria-label={strings.library.searchPlaceholder}
            className="w-full min-w-0 bg-transparent py-1 font-normal text-[15px] text-text-primary outline-none placeholder:text-text-muted"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              aria-label={strings.common.clear}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          )}
          <SearchModeToggle
            mode={searchMode}
            onChange={onSearchModeChange}
            keywordLabel={strings.library.searchModes.lexical}
            semanticLabel={strings.library.searchModes.semantic}
          />
        </div>

        {activityLabel && (
          <div
            role="status"
            className="flex min-w-0 items-center gap-2 rounded-lg bg-surface px-2.5 py-1 text-text-muted text-xs"
          >
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
            <span className="truncate">{activityLabel}</span>
          </div>
        )}
        {refreshAvailable && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshDisabled}
            aria-label={strings.library.refreshRepository.label}
            title={strings.library.refreshRepository.label}
            className={cn(
              'flex size-8 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150',
              refreshDisabled
                ? 'cursor-default opacity-60'
                : 'cursor-pointer hover:bg-hover-tint hover:text-text-primary',
            )}
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
          </div>
        ) : isEmpty || !scopedGraph ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted">
            {setupState === 'setup-required'
              ? strings.library.explorerTree.repositorySetupRequired
              : strings.library.graphEmpty}
          </div>
        ) : (
          <>
            <GraphView
              key={fileIdsKey}
              graph={scopedGraph}
              onOpenNode={(node) =>
                openNote(
                  tabController,
                  { fileType: 'mcanvas', id: node.id },
                  node.name,
                  'graph',
                )
              }
            />
            <div className="pointer-events-none absolute bottom-4 left-6 rounded-lg bg-card/85 px-3 py-1.5 text-text-muted text-xs shadow-ambient backdrop-blur-[24px]">
              {strings.graph.graphStats(
                scopedGraph.nodes.length,
                scopedGraph.edges.length,
              )}
            </div>
          </>
        )}
      </div>
    </div>
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
            'cursor-pointer rounded-[6px] px-2.5 py-1 font-medium text-xs transition-colors duration-150',
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
