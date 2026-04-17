import { CachedRepository } from './cached';
import type { ActiveRepository, RepositoryConfig } from './config';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';

function normalizeOutboxKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'default';
}

function getGitHubStorageKey(
  config: Extract<RepositoryConfig, { kind: 'github' }>,
): string {
  return [
    normalizeOutboxKeyPart(config.owner),
    normalizeOutboxKeyPart(config.repo),
    normalizeOutboxKeyPart(config.branch ?? 'main'),
  ].join('__');
}

export function createRepository(config: RepositoryConfig): ActiveRepository {
  switch (config.kind) {
    case 'local':
      return new LocalRepository();
    case 'github': {
      const storageKey = getGitHubStorageKey(config);
      const cacheRoot = `repositories/github/${storageKey}`;
      return new CachedRepository(
        new GitHubRepository({
          owner: config.owner,
          repo: config.repo,
          branch: config.branch ?? 'main',
          credentialId: config.credentialId,
        }),
        new LocalRepository(cacheRoot),
        `${cacheRoot}/outbox.json`,
      );
    }
  }
}
