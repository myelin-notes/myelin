import { useEffect, useState } from 'react';
import { useLocale, useStrings } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { useRepository } from '@/lib/sync';
import { cn } from '@/lib/utils';

interface SemanticTagsProps {
  refreshKey: number;
  activeTags: Set<string>;
  onActiveTagsChanged: (tags: Set<string>) => void;
}

export function SemanticTags({
  refreshKey,
  activeTags,
  onActiveTagsChanged,
}: SemanticTagsProps) {
  const strings = useStrings();
  const locale = useLocale();
  const repository = useRepository();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalFolders: 0,
    totalTags: 0,
  });

  useEffect(() => {
    Promise.all([repository.listTags(), repository.getStats()])
      .then(([allTags, nextStats]) => {
        setTags(allTags);
        setStats(nextStats);

        // Prune any active tags that no longer exist
        if (activeTags.size > 0) {
          const existing = new Set(allTags.map((t) => t.tag));
          const pruned = new Set(
            [...activeTags].filter((t) => existing.has(t)),
          );
          if (pruned.size !== activeTags.size) {
            onActiveTagsChanged(pruned);
          }
        }
      })
      .catch(console.error);
  }, [refreshKey, activeTags, onActiveTagsChanged, repository]);

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

  return (
    <div className="flex flex-col gap-6 rounded-xl bg-surface p-8">
      {/* Heading */}
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-normal text-text-primary text-xl leading-7">
          {strings.library.semanticTags.title}
        </h3>
        {activeTags.size > 0 && (
          <button
            onClick={clearAll}
            className="cursor-pointer font-bold text-[10px] text-text-muted uppercase tracking-[1px] transition-colors hover:text-text-secondary"
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
        {tags.map(({ tag, count }) => {
          const isActive = activeTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={cn(
                'cursor-pointer rounded-xl px-3 py-1.5 font-medium text-xs transition-all',
                isActive
                  ? 'scale-[1.04] bg-tag-active text-text-on-dark'
                  : 'bg-card text-text-secondary hover:bg-card-active hover:shadow-ambient',
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
                {formatNumber(count, locale)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insights */}
      <div className="flex flex-col gap-4 rounded-lg bg-page p-4">
        <h4 className="font-bold text-[10px] text-text-secondary uppercase tracking-[1px]">
          {strings.library.semanticTags.insights}
        </h4>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-normal text-sm text-text-secondary">
              {strings.library.semanticTags.stats.totalFiles}
            </span>
            <span className="font-medium text-sm text-text-primary tabular-nums">
              {formatNumber(stats.totalFiles, locale)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-normal text-sm text-text-secondary">
              {strings.library.semanticTags.stats.folders}
            </span>
            <span className="font-medium text-sm text-text-primary tabular-nums">
              {formatNumber(stats.totalFolders, locale)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-normal text-sm text-text-secondary">
              {strings.library.semanticTags.stats.uniqueTags}
            </span>
            <span className="font-medium text-sm text-text-primary tabular-nums">
              {formatNumber(stats.totalTags, locale)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
