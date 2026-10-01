import type { RepositoryStatus } from '@myelin/editor/sync/repo-context';
import { useRepository as useEditorRepository } from '@myelin/editor/sync/repo-context';
import type { NativeRepository } from './repo/native';

export {
  RepositoryContext,
  type RepositoryStatus,
  useRepositoryStatus,
} from '@myelin/editor/sync/repo-context';

export function useRepository(): NativeRepository {
  return useEditorRepository() as NativeRepository;
}

export interface RepositoryContextValue {
  repository: NativeRepository;
  status: RepositoryStatus;
}
