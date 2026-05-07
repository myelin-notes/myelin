import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Link2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import {
  type NoteBacklink,
  type StoredNoteLink,
  useRepository,
  useRepositoryStatus,
  type VFSNodeId,
} from '@/lib/sync';
import { cn } from '@/lib/utils';

const logger = new Logger('BacklinksPane');

type BacklinksState =
  | { status: 'loading'; backlinks: NoteBacklink[]; message?: never }
  | { status: 'ready'; backlinks: NoteBacklink[]; message?: never }
  | { status: 'error'; backlinks: NoteBacklink[]; message: string };

// All backlinks from a single source note, collapsed into one card in the UI.
interface BacklinkGroup {
  sourceId: VFSNodeId;
  sourceName: string;
  mentions: StoredNoteLink[];
}

interface SnippetPart {
  text: string;
  highlighted: boolean;
}

interface BacklinksPaneProps {
  noteId: VFSNodeId | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSource: (sourceId: VFSNodeId) => void;
}

export function BacklinksPane({
  noteId,
  open,
  onOpenChange,
  onOpenSource,
}: BacklinksPaneProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<BacklinksState>({
    status: 'loading',
    backlinks: [],
  });

  useEffect(() => {
    if (!noteId) {
      return;
    }

    let cancelled = false;
    const requestKey = `${noteId}:${reloadKey}:${repositoryStatus.lastRemoteSyncAt ?? ''}`;
    setState({ status: 'loading', backlinks: [] });

    repository
      .getBacklinks(noteId)
      .then((backlinks) => {
        if (!cancelled) {
          setState({ status: 'ready', backlinks });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        logger.error('Failed to load backlinks', error, { noteId, requestKey });
        setState({
          status: 'error',
          backlinks: [],
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [noteId, reloadKey, repository, repositoryStatus.lastRemoteSyncAt]);

  const groups = useMemo(
    () => groupBacklinksBySource(state.backlinks),
    [state.backlinks],
  );
  const countLabel = formatNumber(state.backlinks.length, locale);

  if (!noteId) {
    return null;
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            key="backlinks-pane"
            aria-label={strings.canvas.backlinks.title}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
            className="pointer-events-auto absolute top-24 right-6 bottom-24 z-[90] flex w-[20rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl bg-white/85 shadow-ambient backdrop-blur-[24px] lg:top-6 lg:w-[22rem]"
          >
            <div className="flex items-start gap-3 px-4 pt-4 pb-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-accent-navy">
                <Link2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="m-0 truncate font-semibold text-sm text-text-primary">
                    {strings.canvas.backlinks.title}
                  </h2>
                  <span className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-[11px] text-text-secondary tabular-nums">
                    {countLabel}
                  </span>
                </div>
                <p className="m-0 mt-1 text-text-muted text-xs">
                  {strings.canvas.backlinks.linkedMentions}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label={strings.canvas.backlinks.hidePane}
                title={strings.canvas.backlinks.hidePane}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-hover-tint hover:text-text-primary"
              >
                <PanelRightClose className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <BacklinksPaneContent
                groups={groups}
                state={state}
                onOpenSource={onOpenSource}
                onRetry={() => setReloadKey((key) => key + 1)}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {!open && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label={strings.canvas.backlinks.showPane}
          title={strings.canvas.backlinks.showPane}
          className="pointer-events-auto absolute top-6 right-6 z-[90] flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-white/85 px-3 text-text-secondary text-xs shadow-ambient backdrop-blur-[24px] transition-colors hover:bg-white hover:text-text-primary"
        >
          <PanelRightOpen className="size-4" />
          <span className="font-medium tabular-nums">{countLabel}</span>
        </button>
      )}
    </>
  );
}

function BacklinksPaneContent({
  groups,
  state,
  onOpenSource,
  onRetry,
}: {
  groups: BacklinkGroup[];
  state: BacklinksState;
  onOpenSource: (sourceId: VFSNodeId) => void;
  onRetry: () => void;
}) {
  const strings = useMessages();

  if (state.status === 'loading') {
    return <BacklinksSkeleton />;
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-lg bg-surface px-4 py-4">
        <p className="m-0 font-medium text-sm text-text-primary">
          {strings.canvas.backlinks.loadFailed}
        </p>
        <p className="m-0 mt-1 text-text-muted text-xs">{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 font-medium text-text-secondary text-xs transition-colors hover:bg-card-active hover:text-text-primary"
        >
          <RefreshCw className="size-3.5" />
          {strings.canvas.backlinks.retry}
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg bg-surface px-4 py-5">
        <p className="m-0 font-medium text-sm text-text-primary">
          {strings.canvas.backlinks.emptyTitle}
        </p>
        <p className="m-0 mt-1 text-text-muted text-xs leading-5">
          {strings.canvas.backlinks.emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <BacklinkSourceGroup
          key={group.sourceId}
          group={group}
          onOpenSource={onOpenSource}
        />
      ))}
    </div>
  );
}

function BacklinkSourceGroup({
  group,
  onOpenSource,
}: {
  group: BacklinkGroup;
  onOpenSource: (sourceId: VFSNodeId) => void;
}) {
  const strings = useMessages();
  const locale = useLocale();
  const mentionCount = group.mentions.length;

  return (
    <section className="rounded-lg bg-surface/80 p-3">
      <button
        type="button"
        onClick={() => onOpenSource(group.sourceId)}
        className="group flex w-full cursor-pointer items-start gap-2 rounded-md p-1 text-left transition-colors hover:bg-hover-tint"
      >
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate font-medium text-[13px] text-text-primary">
            {group.sourceName}
          </h3>
          <p className="m-0 mt-0.5 text-[11px] text-text-muted">
            {strings.canvas.backlinks.mentionCount(
              mentionCount,
              formatNumber(mentionCount, locale),
            )}
          </p>
        </div>
        <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-text-muted transition-colors group-hover:text-text-secondary" />
      </button>

      <div className="mt-2 space-y-2">
        {group.mentions.map((mention, index) => (
          <button
            key={`${mention.snippet}\0${mention.title}\0${index}`}
            type="button"
            onClick={() => onOpenSource(group.sourceId)}
            className="block w-full cursor-pointer rounded-md bg-card/70 px-3 py-2 text-left text-text-secondary transition-colors hover:bg-card-active hover:text-text-primary"
          >
            <p className="m-0 max-h-16 overflow-hidden text-xs leading-5">
              <HighlightedSnippet
                snippet={mention.snippet}
                title={mention.title}
              />
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function BacklinksSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-lg bg-surface/80 p-3">
          <div className="h-3 w-2/3 animate-pulse rounded-sm bg-border-divider" />
          <div className="mt-3 h-14 animate-pulse rounded-md bg-card/80" />
        </div>
      ))}
    </div>
  );
}

function HighlightedSnippet({
  snippet,
  title,
}: {
  snippet: string;
  title: string;
}) {
  const parts = splitSnippet(snippet, title);

  return (
    <>
      {parts.map((part, index) => (
        <span
          key={`${part.text}\0${index}`}
          className={cn(
            part.highlighted &&
              'rounded-sm bg-secondary-container px-0.5 text-text-primary',
          )}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

function splitSnippet(snippet: string, title: string): SnippetPart[] {
  const target = title.trim();
  if (!target) {
    return [{ text: snippet, highlighted: false }];
  }

  const start = snippet.toLocaleLowerCase().indexOf(target.toLocaleLowerCase());
  if (start < 0) {
    return [{ text: snippet, highlighted: false }];
  }

  const end = start + target.length;
  return [
    { text: snippet.slice(0, start), highlighted: false },
    { text: snippet.slice(start, end), highlighted: true },
    { text: snippet.slice(end), highlighted: false },
  ].filter((part) => part.text.length > 0);
}

function groupBacklinksBySource(backlinks: NoteBacklink[]): BacklinkGroup[] {
  const groups = new Map<VFSNodeId, BacklinkGroup>();

  for (const { sourceId, sourceName, ...mention } of backlinks) {
    const group = groups.get(sourceId);
    if (group) {
      group.mentions.push(mention);
      continue;
    }

    groups.set(sourceId, {
      sourceId,
      sourceName,
      mentions: [mention],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      mentions: [...group.mentions].sort((a, b) =>
        a.snippet.localeCompare(b.snippet),
      ),
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}
