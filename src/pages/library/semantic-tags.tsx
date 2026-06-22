import { memo, useEffect, useMemo, useState } from 'react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { orderTagsHierarchically } from '@/lib/sync/repo/tag-hierarchy';
import { cn } from '@/lib/utils';
import { formatSemanticTagAccessibleName } from './accessibility-labels';

const logger = new Logger('SemanticTags');

interface SemanticTagsProps {
  activeTags: Set<string>;
  onActiveTagsChanged: (tags: Set<string>) => void;
}

export const SemanticTags = memo(function SemanticTags({
  activeTags,
  onActiveTagsChanged,
}: SemanticTagsProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalFolders: 0,
    totalTags: 0,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLoaded(false);
    Promise.all([repository.listTags(true), repository.getStats()])
      .then(([allTags, nextStats]) => {
        if (cancelled) {
          return;
        }

        setTags(allTags);
        setStats(nextStats);
        setLoaded(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        logger.error('Failed to load semantic tags', error);
      });

    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    if (!(loaded && activeTags.size > 0)) {
      return;
    }

    // `tags` holds the synthesized (includeAncestors) list, so exact membership is intentionally correct for hierarchical filters.
    const existing = new Set(tags.map((entry) => entry.tag));
    const pruned = new Set([...activeTags].filter((tag) => existing.has(tag)));
    if (pruned.size !== activeTags.size) {
      onActiveTagsChanged(pruned);
    }
  }, [activeTags, loaded, onActiveTagsChanged, tags]);

  const toggleTag = (tag: string) => {
    const next = new Set(activeTags);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    onActiveTagsChanged(next);
  };

  const clearAll = () => {
    onActiveTagsChanged(new Set());
  };

  // Keep each parent chip next to its descendants while preserving the
  // count-descending order between unrelated tag families.
  const orderedTags = useMemo(() => orderTagsHierarchically(tags), [tags]);

  return (
    <div className="flex flex-col gap-6 rounded-xl bg-surface p-6 ring-1 ring-border-subtle/70 sm:p-8">
      {/* Heading */}
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-normal text-text-primary text-xl leading-7">
          {strings.library.semanticTags.title}
        </h3>
        {activeTags.size > 0 && (
          <button
            onClick={clearAll}
            className="cursor-pointer rounded-lg px-2.5 py-1.5 font-bold text-[10px] text-text-muted uppercase tracking-[1px] ring-1 ring-border-subtle/70 transition-colors hover:bg-hover-tint hover:text-text-secondary"
          >
            {strings.common.clear}
          </button>
        )}
      </div>

      {/* Tag Cloud */}
      <div className="flex min-h-[36px] flex-wrap gap-2">
        {tags.length === 0 && (
          <p className="text-text-muted text-xs italic">
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
              aria-label={formatSemanticTagAccessibleName(
                tag,
                count,
                formattedCount,
              )}
              aria-pressed={isActive}
              className={cn(
                'cursor-pointer rounded-xl px-3 py-1.5 font-medium text-xs transition-all',
                isActive
                  ? 'scale-[1.04] bg-tag-active text-text-on-dark ring-1 ring-accent-navy/20'
                  : 'bg-card text-text-secondary ring-1 ring-border-subtle/70 hover:bg-card-active hover:shadow-ambient',
              )}
            >
              <span className="opacity-50">#</span>
              {tag}
              <span
                className={cn(
                  'ml-1.5 text-[10px]',
                  isActive ? 'text-text-on-dark/60' : 'text-text-muted',
                )}
              >
                {formattedCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insights */}
      <div className="flex flex-col gap-3 rounded-lg bg-page p-4 ring-1 ring-border-subtle/70">
        <h4 className="font-heading font-normal text-sm text-text-secondary italic">
          {strings.library.semanticTags.insights}
        </h4>

        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
          {(
            [
              [stats.totalFiles, strings.library.semanticTags.stats.totalFiles],
              [stats.totalFolders, strings.library.semanticTags.stats.folders],
              [stats.totalTags, strings.library.semanticTags.stats.uniqueTags],
            ] as const
          ).map(([value, label]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="font-heading font-normal text-lg text-text-primary tabular-nums leading-none">
                {formatNumber(value, locale)}
              </span>
              <span className="font-normal text-text-muted text-xs">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
