import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronRight, Hash, Plus, X } from 'lucide-react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import {
  normalizeTagInput,
  orderTagsHierarchically,
  tagMatchesQuery,
} from '@/lib/sync/repo/tag-hierarchy';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';
import { formatSemanticTagAccessibleName } from '@/pages/library/accessibility-labels';
import { TreeIndentGuides, treeRowPadding } from './indent-guides';
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
  // null = not adding; '' = adding a root tag; otherwise the parent tag a new
  // child is being created under.
  const [addParent, setAddParent] = useState<string | null>(null);
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
    if (addParent !== null) {
      inputRef.current?.focus();
    }
  }, [addParent]);

  const startAdd = (parent: string) => {
    setOpen(true);
    setNewTag('');
    setAddParent(parent);
  };

  const submitAdd = async () => {
    const parent = addParent ?? '';
    const normalized = normalizeTagInput(
      parent ? `${parent}/${newTag}` : newTag,
    );
    setNewTag('');
    setAddParent(null);
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
      // Deleting a tag removes its whole subtree, so dropping `A` also drops
      // `A/B` instead of leaving the child stranded.
      const nodes = await repository.getNodesByAnyTag([tag]);
      for (const node of nodes) {
        for (const nodeTag of node.tags) {
          if (tagMatchesQuery(nodeTag, tag)) {
            await repository.removeTag(node.id, nodeTag);
          }
        }
      }
      const registry = await repository.getRegistryTags();
      for (const registryTag of registry) {
        if (tagMatchesQuery(registryTag, tag)) {
          await repository.removeRegistryTag(registryTag);
        }
      }
      handleRegistryChanged();
    } catch (error) {
      logger.error('Failed to delete tag', error, { tag });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey/internalRefresh are triggers that re-run the fetch
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    // Ask for ancestor-inclusive counts so a parent like `uni` surfaces (and
    // counts the whole subtree) even when only `uni/math` is attached.
    Promise.all([repository.listTags(true), repository.getRegistryTags()])
      .then(([hierarchicalTags, registryTags]) => {
        if (cancelled) {
          return;
        }
        const counts = new Map(
          hierarchicalTags.map((entry) => [entry.tag, entry.count]),
        );
        // Show every attached tag (including synthesized ancestors) plus
        // registry tags that exist without being attached to anything yet.
        const allTags = new Set<string>([
          ...hierarchicalTags.map((entry) => entry.tag),
          ...registryTags,
        ]);
        setTags(
          [...allTags].map((tag) => ({ tag, count: counts.get(tag) ?? 0 })),
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

  // Inline editor row used both for a new root tag and a new child under a
  // parent; the parent segment is shown as a static prefix.
  const addRow = (depth: number, parent: string | null) => {
    const parentLeaf = parent
      ? parent.slice(parent.lastIndexOf('/') + 1)
      : null;
    return (
      <div
        className="relative flex items-center gap-1 rounded-md pr-1"
        style={{ paddingLeft: treeRowPadding(depth) }}
      >
        <TreeIndentGuides depth={depth} />
        <span className="shrink-0 font-medium text-[11px] text-text-muted">
          <span className="opacity-50">#</span>
          {parentLeaf ? `${parentLeaf}/` : ''}
        </span>
        <input
          ref={inputRef}
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onBlur={submitAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              submitAdd();
            }
            if (e.key === 'Escape') {
              setNewTag('');
              setAddParent(null);
            }
          }}
          placeholder={strings.library.semanticTags.placeholder}
          className="min-w-0 flex-1 border-accent-dark/40 border-b bg-transparent py-1 font-medium text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
    );
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
        <span className="px-1 text-text-muted text-xs tabular-nums">
          {formatNumber(tags.length, locale)}
        </span>
        <button
          type="button"
          onClick={() => startAdd('')}
          aria-label={strings.library.semanticTags.addTag}
          title={strings.library.semanticTags.addTag}
          className="mr-1.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-hover-tint hover:text-text-primary"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {open && (
        <div
          style={{ height }}
          className={cn(
            'flex flex-col overflow-y-auto px-1.5 pt-0.5 pb-2',
            tags.length === 0 && 'justify-center',
          )}
        >
          {tags.length === 0 ? (
            addParent !== null ? (
              addRow(0, null)
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 px-4 text-center">
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
                <button
                  type="button"
                  onClick={() => startAdd('')}
                  className="flex cursor-pointer items-center gap-1 rounded-lg border border-text-muted/40 border-dashed bg-transparent px-2 py-1 font-medium text-[11px] text-text-muted transition-colors hover:border-text-muted/60 hover:text-text-secondary"
                >
                  <Plus className="size-3" />
                  {strings.library.semanticTags.addTag}
                </button>
              </div>
            )
          ) : (
            <>
              {addParent === '' && addRow(0, null)}
              {orderedTags.map(({ tag, count, depth, label }) => {
                const isActive = activeTags.has(tag);
                const formattedCount = formatNumber(count, locale);
                return (
                  <Fragment key={tag}>
                    <div
                      className={cn(
                        'group/tag relative flex items-center gap-1 rounded-md pr-1 transition-colors',
                        isActive
                          ? 'bg-tag-active text-text-on-dark'
                          : 'text-text-secondary hover:bg-hover-tint',
                      )}
                    >
                      <TreeIndentGuides depth={depth} />
                      <button
                        type="button"
                        onClick={() => toggleTag(tag)}
                        aria-label={formatSemanticTagAccessibleName(
                          tag,
                          count,
                          formattedCount,
                        )}
                        aria-pressed={isActive}
                        style={{ paddingLeft: treeRowPadding(depth) }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-1 text-left font-medium text-[11px]"
                      >
                        <span className="shrink-0 opacity-50">#</span>
                        <span className="truncate">{label}</span>
                      </button>
                      <span
                        className={cn(
                          'shrink-0 text-[9px] tabular-nums',
                          isActive ? 'text-text-on-dark/60' : 'text-text-muted',
                        )}
                      >
                        {formattedCount}
                      </span>
                      <button
                        type="button"
                        onClick={() => startAdd(tag)}
                        aria-label={strings.library.semanticTags.addChild(tag)}
                        title={strings.library.semanticTags.addChild(tag)}
                        className={cn(
                          'flex shrink-0 cursor-pointer items-center rounded p-0.5 opacity-0 transition-opacity group-hover/tag:opacity-100',
                          isActive
                            ? 'text-text-on-dark/70 hover:text-text-on-dark'
                            : 'text-text-muted hover:text-text-primary',
                        )}
                      >
                        <Plus className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTag(tag)}
                        aria-label={strings.library.semanticTags.deleteTag(tag)}
                        className={cn(
                          'flex shrink-0 cursor-pointer items-center rounded p-0.5 opacity-0 transition-opacity group-hover/tag:opacity-100',
                          isActive
                            ? 'text-text-on-dark/70 hover:text-text-on-dark'
                            : 'text-text-muted hover:text-destructive',
                        )}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                    {addParent === tag && addRow(depth + 1, tag)}
                  </Fragment>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
});
