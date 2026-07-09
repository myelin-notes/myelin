/**
 * App-side repository composition types. The pure pieces (config shape,
 * lifecycle, status) live in `@myelin/editor`; the compositions here are
 * rebuilt on the app's `Repository` (which adds `openSession`).
 */

import type {
  RepositoryLifecycle,
  RepositoryStatusSource,
} from '@myelin/editor/sync/repo/config';
import type { YjsSyncTarget } from '@myelin/editor/sync/types';
import type { Repository } from './types';

export * from '@myelin/editor/sync/repo/config';

/** A repository that can be read and have its note documents loaded. */
export type ReadableRepository = Repository &
  Pick<YjsSyncTarget, 'loadDocument'>;

export type ActiveRepository = Repository &
  YjsSyncTarget &
  RepositoryLifecycle &
  RepositoryStatusSource;
