import type { RepositoryConfig } from './config';
import { hasGitHubToken } from './github-credentials';
export const REPOSITORY_SETUP_INCOMPLETE_MESSAGE =
  'Finish repository setup in Settings before creating notes.';

export class RepositorySetupIncompleteError extends Error {
  constructor() {
    super(REPOSITORY_SETUP_INCOMPLETE_MESSAGE);
    this.name = 'RepositorySetupIncompleteError';
  }
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function isRepositoryConfigStructurallyComplete(
  config: RepositoryConfig,
): boolean {
  switch (config.kind) {
    case 'local':
      return true;
    case 'github':
      return (
        hasText(config.owner) &&
        hasText(config.repo) &&
        hasText(config.branch ?? 'main')
      );
  }
}

export async function isRepositoryFullyConfigured(
  config: RepositoryConfig,
): Promise<boolean> {
  if (!isRepositoryConfigStructurallyComplete(config)) {
    return false;
  }

  try {
    switch (config.kind) {
      case 'local':
        return true;
      case 'github':
        return hasGitHubToken(config.credentialId);
    }
  } catch {
    return false;
  }
}
