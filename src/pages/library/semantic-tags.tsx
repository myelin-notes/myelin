import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { FileSystem, type VFSManifest } from '@/lib/utils/file-system';

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
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalFolders: 0,
    totalTags: 0,
  });

  useEffect(() => {
    FileSystem.getManifest().then((manifest: VFSManifest) => {
      const allTags = FileSystem.getAllTags(manifest);
      setTags(allTags);
      setStats(FileSystem.getStats(manifest));

      // Prune any active tags that no longer exist
      if (activeTags.size > 0) {
        const existing = new Set(allTags.map((t) => t.tag));
        const pruned = new Set([...activeTags].filter((t) => existing.has(t)));
        if (pruned.size !== activeTags.size) {
          onActiveTagsChanged(pruned);
        }
      }
    });
  }, [refreshKey, activeTags, onActiveTagsChanged]);

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
          Semantic Tags
        </h3>
        {activeTags.size > 0 && (
          <button
            onClick={clearAll}
            className="cursor-pointer font-bold text-[10px] text-text-muted uppercase tracking-[1px] transition-colors hover:text-text-secondary"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tag Cloud */}
      <div className="flex min-h-[36px] flex-wrap gap-2">
        {tags.length === 0 && (
          <p className="text-text-muted text-xs italic">
            No tags yet. Right-click a file and choose &ldquo;Manage Tags&rdquo;
            to start.
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
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insights */}
      <div className="flex flex-col gap-4 rounded-lg bg-page p-4">
        <h4 className="font-bold text-[10px] text-text-secondary uppercase tracking-[1px]">
          Studio Insights
        </h4>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-normal text-sm text-text-secondary">
              Total Files
            </span>
            <span className="font-medium text-sm text-text-primary tabular-nums">
              {stats.totalFiles}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-normal text-sm text-text-secondary">
              Folders
            </span>
            <span className="font-medium text-sm text-text-primary tabular-nums">
              {stats.totalFolders}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-normal text-sm text-text-secondary">
              Unique Tags
            </span>
            <span className="font-medium text-sm text-text-primary tabular-nums">
              {stats.totalTags}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
