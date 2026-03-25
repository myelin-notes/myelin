import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { FileSystem, VFSManifest } from "@/lib/utils/file-system";

interface SemanticTagsProps {
  refreshKey: number;
  activeTags: Set<string>;
  onActiveTagsChanged: (tags: Set<string>) => void;
}

export function SemanticTags({ refreshKey, activeTags, onActiveTagsChanged }: SemanticTagsProps) {
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState({ totalFiles: 0, totalFolders: 0, totalTags: 0 });

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
  }, [refreshKey]);

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
        <h3 className="font-heading text-xl font-normal text-text-primary leading-7">
          Semantic Tags
        </h3>
        {activeTags.size > 0 && (
          <button
            onClick={clearAll}
            className="text-[10px] font-bold uppercase tracking-[1px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tag Cloud */}
      <div className="flex flex-wrap gap-2 min-h-[36px]">
        {tags.length === 0 && (
          <p className="text-xs text-text-muted italic">
            No tags yet. Right-click a file and choose &ldquo;Manage Tags&rdquo; to start.
          </p>
        )}
        {tags.map(({ tag, count }) => {
          const isActive = activeTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer",
                isActive
                  ? "bg-tag-active text-text-on-dark shadow-md scale-[1.04]"
                  : "bg-card text-text-secondary hover:shadow-md"
              )}
            >
              <span className="opacity-50">#</span>
              {tag}
              <span
                className={cn(
                  "ml-1.5 text-[10px]",
                  isActive ? "text-text-on-dark/60" : "text-text-muted"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insights */}
      <div className={cn(
        "flex flex-col gap-4 border-t border-border-subtle",
        "pt-4"
      )}>
        <h4 className="text-[10px] font-bold uppercase tracking-[1px] text-text-secondary">
          Studio Insights
        </h4>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-normal text-text-secondary">Total Files</span>
            <span className="text-sm font-medium text-text-primary tabular-nums">
              {stats.totalFiles}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-normal text-text-secondary">Folders</span>
            <span className="text-sm font-medium text-text-primary tabular-nums">
              {stats.totalFolders}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-normal text-text-secondary">Unique Tags</span>
            <span className="text-sm font-medium text-text-primary tabular-nums">
              {stats.totalTags}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
