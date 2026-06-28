import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { orderTagsHierarchically } from '@/lib/sync/repo/tag-hierarchy';
import { cn } from '@/lib/utils';
import { formatSemanticTagAccessibleName } from '../accessibility-labels';
import { TagRegistryDialog } from '../tag-registry-dialog';
import type { RepositorySetupState } from '../use-repository-setup-state';

const logger = new Logger('TagListPanel');

interface TagListPanelProps {
  activeTags: Set<string>;
  onActiveTagsChanged: (tags: Set<string>) => void;
  /** Refresh the file pane after tags are created or deleted. */
  onTagsChanged: () => void;
  setupState: RepositorySetupState;
  /** Bumped by the parent to refetch tags after external changes. */
  refreshKey?: number;
}

export function TagListPanel({
  activeTags,
  onActiveTagsChanged,
  onTagsChanged,
  setupState,
  refreshKey = 0,
}: TagListPanelProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);

  const reload = useCallback(() => setLocalRefresh((key) => key + 1), []);

  const handleRegistryChanged = useCallback(() => {
    reload();
    onTagsChanged();
  }, [reload, onTagsChanged]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: localRefresh/refreshKey are triggers that re-run the fetch; they aren't read in the body
  useEffect(() => {
    if (setupState !== 'ready') {
      return;
    }
    let cancelled = false;
    setLoaded(false);
    Promise.all([repository.listTags(), repository.getRegistryTags()])
      .then(([attachedTags, registryTags]) => {
        if (cancelled) {
          return;
        }
        const counts = new Map(
          attachedTags.map((entry) => [entry.tag, entry.count]),
        );
        setTags(
          registryTags.map((tag) => ({ tag, count: counts.get(tag) ?? 0 })),
        );
        setLoaded(true);
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Failed to load tags', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, localRefresh, refreshKey, setupState]);

  // Drop any active tags that no longer exist after a registry edit.
  useEffect(() => {
    if (!(loaded && activeTags.size > 0)) {
      return;
    }
    const existing = new Set(tags.map((entry) => entry.tag));
    const pruned = new Set([...activeTags].filter((tag) => existing.has(tag)));
    if (pruned.size !== activeTags.size) {
      onActiveTagsChanged(pruned);
    }
  }, [activeTags, loaded, onActiveTagsChanged, tags]);

  const orderedTags = useMemo(() => orderTagsHierarchically(tags), [tags]);

  const toggleTag = (tag: string) => {
    const next = new Set(activeTags);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    onActiveTagsChanged(next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
          {strings.library.lens.tags}
        </span>
        {activeTags.size > 0 && (
          <button
            type="button"
            onClick={() => onActiveTagsChanged(new Set())}
            className="cursor-pointer rounded-md px-1.5 py-0.5 font-bold text-[10px] text-text-muted uppercase tracking-[1px] transition-colors hover:bg-hover-tint hover:text-text-secondary"
          >
            {strings.common.clear}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {tags.length === 0 && loaded && (
          <p className="px-3 py-2 text-text-muted text-xs italic">
            {strings.library.semanticTags.empty}
          </p>
        )}
        {orderedTags.map(({ tag, count }) => {
          const isActive = activeTags.has(tag);
          const formattedCount = formatNumber(count, locale);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              aria-pressed={isActive}
              aria-label={formatSemanticTagAccessibleName(
                tag,
                count,
                formattedCount,
              )}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
                isActive
                  ? 'bg-accent/15 font-medium text-text-primary'
                  : 'text-text-secondary hover:bg-hover-tint',
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                  isActive
                    ? 'border-accent-dark bg-accent-dark text-text-on-dark'
                    : 'border-border-subtle text-transparent',
                )}
              >
                <Check className="size-3" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="opacity-50">#</span>
                {tag}
              </span>
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  isActive ? 'text-text-secondary' : 'text-text-muted',
                )}
              >
                {formattedCount}
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-border-subtle/60 border-t px-3 py-2">
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="w-full cursor-pointer rounded-lg border border-text-muted/40 border-dashed bg-transparent px-3 py-1.5 font-medium text-text-muted text-xs transition-colors hover:border-text-muted/60 hover:text-text-secondary"
        >
          {strings.library.semanticTags.manageTag}
        </button>
      </div>

      <TagRegistryDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        onChanged={handleRegistryChanged}
      />
    </div>
  );
}
