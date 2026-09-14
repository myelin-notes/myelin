import type { RepositoryConfig } from './config';
import {
  isRepositoryFullyConfigured as isFullyConfigured,
  isRepositoryConfigStructurallyComplete as isStructurallyComplete,
} from './repository-backends';

export const REPOSITORY_SETUP_INCOMPLETE_MESSAGE =
  'Finish repository setup in Settings before creating notes.';

export class RepositorySetupIncompleteError extends Error {
  constructor() {
    super(REPOSITORY_SETUP_INCOMPLETE_MESSAGE);
    this.name = 'RepositorySetupIncompleteError';
  }
}

export function isRepositoryConfigStructurallyComplete(
  config: RepositoryConfig,
): boolean {
  return isStructurallyComplete(config);
}

export async function isRepositoryFullyConfigured(
  config: RepositoryConfig,
): Promise<boolean> {
  return isFullyConfigured(config);
}
