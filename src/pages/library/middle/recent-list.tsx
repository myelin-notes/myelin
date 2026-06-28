import { useEffect, useMemo, useState } from 'react';
import { useLocale, useMessages } from '@/lib/i18n';
import { formatNumber } from '@/lib/i18n/format';
import { Logger } from '@/lib/logger';
import { useRepository, type VFSFileNode } from '@/lib/sync';
import { cn } from '@/lib/utils';
import {
  groupRecentFiles,
  RECENT_BUCKETS,
  RECENT_LENS_LIMIT,
} from '../recent-buckets';
import type { RecentBucket } from '../types';
import type { RepositorySetupState } from '../use-repository-setup-state';

const logger = new Logger('RecentList');

interface RecentListProps {
  selectedBucket: RecentBucket | null;
  onSelect: (bucket: RecentBucket | null) => void;
  setupState: RepositorySetupState;
  /** Bumped by the parent to refetch after files change. */
  version: number;
}

export function RecentList({
  selectedBucket,
  onSelect,
  setupState,
  version,
}: RecentListProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const [files, setFiles] = useState<VFSFileNode[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a refetch trigger, not read in the body
  useEffect(() => {
    if (setupState !== 'ready') {
      setFiles([]);
      return;
    }
    let cancelled = false;
    repository
      .getRecentFiles(RECENT_LENS_LIMIT)
      .then((recent) => {
        if (!cancelled) {
          setFiles(recent);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Failed to load recent files', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, setupState, version]);

  const counts = useMemo(() => {
    const groups = groupRecentFiles(files, Date.now());
    return RECENT_BUCKETS.map((bucket) => ({
      bucket,
      count: groups[bucket].length,
    }));
  }, [files]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 pb-2 font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
        {strings.library.lens.recent}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <BucketRow
          label={strings.library.allFiles}
          countLabel={formatNumber(files.length, locale)}
          active={selectedBucket === null}
          onClick={() => onSelect(null)}
        />
        {counts.map(({ bucket, count }) => (
          <BucketRow
            key={bucket}
            label={strings.library.recentBuckets[bucket]}
            countLabel={formatNumber(count, locale)}
            active={selectedBucket === bucket}
            onClick={() => onSelect(selectedBucket === bucket ? null : bucket)}
          />
        ))}
      </div>
    </div>
  );
}

function BucketRow({
  label,
  countLabel,
  active,
  onClick,
}: {
  label: string;
  countLabel: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150',
        active
          ? 'bg-accent/15 font-medium text-text-primary'
          : 'text-text-secondary hover:bg-hover-tint',
      )}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          'shrink-0 text-xs tabular-nums',
          active ? 'text-text-secondary' : 'text-text-muted',
        )}
      >
        {countLabel}
      </span>
    </button>
  );
}
