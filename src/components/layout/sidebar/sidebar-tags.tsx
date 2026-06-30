import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Hash, Plus, X } from 'lucide-react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import {
  normalizeTagInput,
  orderTagsHierarchically,
} from '@/lib/sync/repo/tag-hierarchy';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { formatSemanticTagAccessibleName } from '@/pages/library/accessibility-labels';
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
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const createTag = async () => {
    const normalized = normalizeTagInput(newTag);
    setNewTag('');
    setIsAdding(false);
    if (!normalized) {
      return;
    }
    try {
      await repository.addRegistryTags([normalized]);
      handleRegistryChanged();
    } catch (error) {
      logger.error('Failed to create tag', error, { tag: normalized });
    }
  };

  const deleteTag = async (tag: string) => {
    try {
      const nodes = await repository.getNodesByAnyTag([tag]);
      for (const node of nodes) {
        await repository.removeTag(node.id, tag);
      }
      await repository.removeRegistryTag(tag);
      handleRegistryChanged();
    } catch (error) {
      logger.error('Failed to delete tag', error, { tag });
    }
  };

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

  const createControl = isAdding ? (
    <div className="flex items-center gap-1 rounded-lg bg-card px-2 py-1 ring-1 ring-border-subtle/70">
      <span className="text-[11px] text-text-muted">#</span>
      <input
        ref={inputRef}
        value={newTag}
        onChange={(e) => setNewTag(e.target.value)}
        onBlur={createTag}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            createTag();
          }
          if (e.key === 'Escape') {
            setNewTag('');
            setIsAdding(false);
          }
        }}
        placeholder={strings.library.semanticTags.placeholder}
        className="w-20 bg-transparent font-medium text-[11px] text-text-primary outline-none placeholder:text-text-muted"
      />
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setIsAdding(true)}
      aria-label={strings.library.semanticTags.addTag}
      title={strings.library.semanticTags.addTag}
      className="flex cursor-pointer items-center gap-1 rounded-lg border border-text-muted/40 border-dashed bg-transparent px-2 py-1 font-medium text-[11px] text-text-muted transition-colors hover:border-text-muted/60 hover:text-text-secondary"
    >
      <Plus className="size-3" />
      {strings.library.semanticTags.addTag}
    </button>
  );

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
          className={cn(
            'overflow-y-auto px-2 pt-0.5 pb-3',
            tags.length === 0 ? 'flex' : 'flex flex-wrap content-start gap-1.5',
          )}
        >
          {tags.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-4 text-center">
              <div className="flex size-9 items-center justify-center rounded-full bg-card text-text-muted ring-1 ring-border-subtle/70">
                <Hash className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="font-medium text-text-secondary text-xs">
                  {strings.library.semanticTags.empty}
                </p>
                <p className="text-[11px] text-text-muted">
                  {strings.library.semanticTags.emptyHint}
                </p>
              </div>
              {createControl}
            </div>
          ) : (
            orderedTags.map(({ tag, count }) => {
              const isActive = activeTags.has(tag);
              const formattedCount = formatNumber(count, locale);
              return (
                <div
                  key={tag}
                  className={cn(
                    'group/tag flex items-center rounded-lg font-medium text-[11px] transition-colors',
                    isActive
                      ? 'bg-tag-active text-text-on-dark'
                      : 'bg-card text-text-secondary ring-1 ring-border-subtle/70 hover:bg-card-active',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-label={formatSemanticTagAccessibleName(
                      tag,
                      count,
                      formattedCount,
                    )}
                    aria-pressed={isActive}
                    className="cursor-pointer rounded-l-lg py-1 pr-1 pl-2"
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
                  <button
                    type="button"
                    onClick={() => deleteTag(tag)}
                    aria-label={strings.library.semanticTags.deleteTag(tag)}
                    className={cn(
                      'flex shrink-0 cursor-pointer items-center self-stretch rounded-r-lg pr-1.5 pl-0.5 opacity-0 transition-opacity group-hover/tag:opacity-100',
                      isActive
                        ? 'text-text-on-dark/70 hover:text-text-on-dark'
                        : 'text-text-muted hover:text-destructive',
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })
          )}
          {tags.length > 0 && createControl}
        </div>
      )}
    </div>
  );
});
