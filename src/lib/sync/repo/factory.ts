import type { ActiveRepository, RepositoryConfig } from './config';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';

export function createRepository(config: RepositoryConfig): ActiveRepository {
  switch (config.kind) {
    case 'local':
      return new LocalRepository();
    case 'github':
      return new GitHubRepository({
        owner: config.owner,
        repo: config.repo,
        branch: config.branch ?? 'main',
        credentialId: config.credentialId,
      });
  }
}
