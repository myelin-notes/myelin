import type { VFSFileNode } from '@/lib/sync';
import type { RecentBucket } from './types';

export const RECENT_BUCKETS: RecentBucket[] = [
  'today',
  'week',
  'month',
  'earlier',
];

/** How many recent files to pull when grouping for the Recent lens. */
export const RECENT_LENS_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Classify a timestamp into a recency bucket using rolling thresholds anchored
 * at the start of the current day: today, the trailing week, the trailing
 * month, then everything older.
 */
export function bucketForTimestamp(ts: number, now: number): RecentBucket {
  const todayStart = startOfDay(now);
  if (ts >= todayStart) {
    return 'today';
  }
  if (ts >= now - 7 * DAY_MS) {
    return 'week';
  }
  if (ts >= now - 30 * DAY_MS) {
    return 'month';
  }
  return 'earlier';
}

export type RecentGroups = Record<RecentBucket, VFSFileNode[]>;

/** Group recent files (assumed already sorted newest-first) by bucket. */
export function groupRecentFiles(
  files: VFSFileNode[],
  now: number,
): RecentGroups {
  const groups: RecentGroups = {
    today: [],
    week: [],
    month: [],
    earlier: [],
  };
  for (const file of files) {
    groups[bucketForTimestamp(file.modifiedAt, now)].push(file);
  }
  return groups;
}
