import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Hash } from 'lucide-react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { orderTagsHierarchically } from '@/lib/sync/repo/tag-hierarchy';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { formatSemanticTagAccessibleName } from '@/pages/library/accessibility-labels';
import { TagRegistryDialog } from '@/pages/library/tag-registry-dialog';
import { useResizeHandle } from './use-resize-handle';

const logger = new Logger('SidebarTags');
const TAGS_MIN_HEIGHT = 80;
const TAGS_MAX_HEIGHT = 400;

function clampTagsHeight(height: number): number {
  return Math.min(Math.max(height, TAGS_MIN_HEIGHT), TAGS_MAX_HEIGHT);
}

interface SidebarTagsProps {
  activeTags: Set<string>;
  onActiveTagsChanged: (tags: Set<string>) => void;
  /** Refresh the tree after tags are created or deleted. */
  onTagsChanged: () => void;
  /** Bumped externally to force a tag-list reload. */
  refreshKey: number;
}

export const SidebarTags = memo(function SidebarTags({
  activeTags,
  onActiveTagsChanged,
  onTagsChanged,
  refreshKey,
}: SidebarTagsProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [internalRefresh, setInternalRefresh] = useState(0);
  const [manageOpen, setManageOpen] = useState(false);
  const [height, setHeightState] = useState(() =>
    clampTagsHeight(UserPrefs.get('sidebarTagsHeight')),
  );

  const setHeight = useCallback((next: number) => {
    const clamped = clampTagsHeight(next);
    setHeightState(clamped);
    UserPrefs.set('sidebarTagsHeight', clamped);
  }, []);

  // Dragging up grows the panel, so the y-axis is inverted.
  const resizeHandleProps = useResizeHandle({
    axis: 'y',
    value: height,
    onChange: setHeight,
    invert: true,
  });

  const handleRegistryChanged = useCallback(() => {
    setInternalRefresh((key) => key + 1);
    onTagsChanged();
  }, [onTagsChanged]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey/internalRefresh are triggers that re-run the fetch
  useEffect(() => {
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
          logger.error('Failed to load sidebar tags', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, refreshKey, internalRefresh]);

  // Drop active tags that no longer exist after a registry edit.
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
    <div className="flex flex-col">
      {open ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize tags"
          aria-valuenow={height}
          aria-valuemin={TAGS_MIN_HEIGHT}
          aria-valuemax={TAGS_MAX_HEIGHT}
          tabIndex={0}
          {...resizeHandleProps}
          className="h-1.5 shrink-0 cursor-row-resize border-border-subtle border-t outline-none transition-colors hover:border-accent-dark/30 focus-visible:border-accent-dark/40"
        />
      ) : null}
      <div
        className={cn(
          'flex items-center',
          !open && 'border-border-subtle border-t',
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-2.5 text-text-secondary transition-colors duration-150 hover:bg-hover-tint"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-text-muted transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
          <Hash className="size-3.5 shrink-0 text-text-muted" />
          <span className="font-bold text-[11px] uppercase tracking-[0.08em]">
            {strings.sidebar.tags}
          </span>
        </button>
        <span className="px-2 text-text-muted text-xs tabular-nums">
          {formatNumber(tags.length, locale)}
        </span>
      </div>

      {open && (
        <div
          style={{ height }}
          className="flex flex-wrap content-start gap-1.5 overflow-y-auto px-2 pt-0.5 pb-3"
        >
          {tags.length === 0 ? (
            <p className="text-text-muted text-xs italic">
              {strings.library.semanticTags.empty}
            </p>
          ) : (
            orderedTags.map(({ tag, count }) => {
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
                    'cursor-pointer rounded-lg px-2 py-1 font-medium text-[11px] transition-colors',
                    isActive
                      ? 'bg-tag-active text-text-on-dark'
                      : 'bg-card text-text-secondary ring-1 ring-border-subtle/70 hover:bg-card-active',
                  )}
                >
                  <span className="opacity-50">#</span>
                  {tag}
                  <span
                    className={cn(
                      'ml-1 text-[9px]',
                      isActive ? 'text-text-on-dark/60' : 'text-text-muted',
                    )}
                  >
                    {formattedCount}
                  </span>
                </button>
              );
            })
          )}
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="cursor-pointer rounded-lg border border-text-muted/40 border-dashed bg-transparent px-2 py-1 font-medium text-[11px] text-text-muted transition-colors hover:border-text-muted/60 hover:text-text-secondary"
          >
            {strings.library.semanticTags.manageTag}
          </button>
        </div>
      )}

      <TagRegistryDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        onChanged={handleRegistryChanged}
      />
    </div>
  );
});
