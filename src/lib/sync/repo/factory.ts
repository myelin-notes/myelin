import type { ActiveRepository, RepositoryConfig } from './config';
import { LocalRepository } from './local';

export function createRepository(config: RepositoryConfig): ActiveRepository {
  switch (config.kind) {
    case 'local':
      return new LocalRepository();
    case 'github':
      throw new Error('GitHub repository backend is not implemented yet.');
  }
}
