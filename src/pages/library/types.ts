import type { SearchNodesOptions } from '@/lib/sync';

export type SortMode = 'name-asc' | 'name-desc' | 'modified' | 'created';
export type ViewMode = 'tree' | 'grid';
export type SearchMode = NonNullable<SearchNodesOptions['mode']>;

/**
 * The active navigation lens. Files/Recent/Tags swap the middle column while
 * the file results pane on the right stays constant; Graph is a destination
 * (it opens the graph tab) rather than a lens.
 */
export type LibraryLens = 'files' | 'recent' | 'tags';

/** A bucket the Recent lens groups files into by last-modified time. */
export type RecentBucket = 'today' | 'week' | 'month' | 'earlier';
