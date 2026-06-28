import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import type { SupportedLocale } from '@/lib/i18n/messages';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import {
  buildTagTree,
  expandTagWithAncestors,
  indexTagTree,
  type TagTreeNode,
  toggleTagSelection,
} from '@/lib/sync/repo/tag-hierarchy';
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
  // Tags whose subtree the user has collapsed. Empty means everything is
  // expanded, which is the default for the fully-loaded tag tree.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

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
    // Hierarchical counts so a parent reflects every item under its subtree,
    // which is exactly what selecting it filters by.
    Promise.all([repository.listTags(true), repository.getRegistryTags()])
      .then(([attachedTags, registryTags]) => {
        if (cancelled) {
          return;
        }
        const counts = new Map(
          attachedTags.map((entry) => [entry.tag, entry.count]),
        );
        // Show every registry tag plus the ancestors needed to nest it, so a
        // registered "a/b" still appears under a parent "a" node.
        const displayed = new Set<string>();
        for (const tag of registryTags) {
          for (const ancestor of expandTagWithAncestors(tag)) {
            displayed.add(ancestor);
          }
        }
        setTags(
          [...displayed].map((tag) => ({ tag, count: counts.get(tag) ?? 0 })),
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

  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const byTag = useMemo(() => indexTagTree(tree), [tree]);

  const toggleTag = useCallback(
    (tag: string) => {
      onActiveTagsChanged(toggleTagSelection(activeTags, tag, byTag));
    },
    [activeTags, byTag, onActiveTagsChanged],
  );

  const toggleCollapse = useCallback((tag: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

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
        {tree.map((node) => (
          <TagTreeNodeView
            key={node.tag}
            node={node}
            depth={0}
            ancestorSelected={false}
            activeTags={activeTags}
            collapsed={collapsed}
            onToggleTag={toggleTag}
            onToggleCollapse={toggleCollapse}
            locale={locale}
          />
        ))}
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

interface TagTreeNodeViewProps {
  node: TagTreeNode;
  depth: number;
  /** Whether a selected ancestor already covers this node (so it reads checked). */
  ancestorSelected: boolean;
  activeTags: Set<string>;
  collapsed: Set<string>;
  onToggleTag: (tag: string) => void;
  onToggleCollapse: (tag: string) => void;
  locale: SupportedLocale;
}

function TagTreeNodeView({
  node,
  depth,
  ancestorSelected,
  activeTags,
  collapsed,
  onToggleTag,
  onToggleCollapse,
  locale,
}: TagTreeNodeViewProps) {
  const isChecked = ancestorSelected || activeTags.has(node.tag);
  const hasChildren = node.children.length > 0;
  const isExpanded = !collapsed.has(node.tag);
  const formattedCount = formatNumber(node.count, locale);
  const indentStyle = { paddingLeft: `${depth * 14 + 4}px` };

  return (
    <>
      <div
        className={cn(
          'group flex w-full items-center gap-1 rounded-lg pr-2 transition-colors duration-150',
          isChecked ? 'bg-accent/15' : 'hover:bg-hover-tint',
        )}
        style={indentStyle}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(node.tag);
            }}
            aria-label={node.label}
            aria-expanded={isExpanded}
            className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-secondary"
          >
            <ChevronRight
              className={cn(
                'size-3 transition-transform duration-150',
                isExpanded && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggleTag(node.tag)}
          aria-pressed={isChecked}
          aria-label={formatSemanticTagAccessibleName(
            node.tag,
            node.count,
            formattedCount,
          )}
          className={cn(
            'flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 text-left text-sm transition-colors duration-150',
            isChecked ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
        >
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
              isChecked
                ? 'border-accent-dark bg-accent-dark text-text-on-dark'
                : 'border-border-subtle text-transparent',
            )}
          >
            <Check className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="opacity-50">#</span>
            {node.label}
          </span>
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              isChecked ? 'text-text-secondary' : 'text-text-muted',
            )}
          >
            {formattedCount}
          </span>
        </button>
      </div>

      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TagTreeNodeView
            key={child.tag}
            node={child}
            depth={depth + 1}
            ancestorSelected={isChecked}
            activeTags={activeTags}
            collapsed={collapsed}
            onToggleTag={onToggleTag}
            onToggleCollapse={onToggleCollapse}
            locale={locale}
          />
        ))}
    </>
  );
}
