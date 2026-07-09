/**
 * App-side view of the repository context owned by `@myelin/editor`. The
 * package context is typed with the editor's session-less `ActiveRepository`;
 * the app's `RepositoryProvider` only ever installs the app's richer
 * `ActiveRepository`, so the cast below is sound.
 */

import { useRepository as useEditorRepository } from '@myelin/editor/sync/repo-context';
import type { ActiveRepository } from './repo/config';

export {
  RepositoryContext,
  type RepositoryContextValue,
  type RepositoryStatus,
  useRepositoryStatus,
} from '@myelin/editor/sync/repo-context';

export function useRepository(): ActiveRepository {
  return useEditorRepository() as ActiveRepository;
}
