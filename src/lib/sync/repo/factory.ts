import { CachedRepository } from './cached';
import {
  type ActiveRepository,
  getRepositoryStorageKey,
  type RepositoryConfig,
} from './config';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';
import {
  isRepositoryFullyConfigured,
  RepositorySetupIncompleteError,
} from './readiness';
import type { CreateFileOptions, FileType } from './types';

function guardNoteCreation(
  repository: ActiveRepository,
  config: RepositoryConfig,
): ActiveRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === 'createFile') {
        return async (
          name: string,
          fileType: FileType,
          parentId: string | null,
          bytes?: Uint8Array,
          options?: CreateFileOptions,
        ) => {
          if (
            fileType === 'mcanvas' &&
            !(await isRepositoryFullyConfigured(config))
          ) {
            throw new RepositorySetupIncompleteError();
          }

          return target.createFile(name, fileType, parentId, bytes, options);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ActiveRepository;
}

export function createRepository(config: RepositoryConfig): ActiveRepository {
  let repository: ActiveRepository;

  switch (config.kind) {
    case 'local': {
      repository = new LocalRepository();
      break;
    }
    case 'github': {
      const cacheRoot = `repositories/github/${getRepositoryStorageKey(config)}`;
      repository = new CachedRepository(
        new GitHubRepository({
          owner: config.owner,
          repo: config.repo,
          branch: config.branch ?? 'main',
          credentialId: config.credentialId,
        }),
        new LocalRepository(cacheRoot),
        `${cacheRoot}/outbox.json`,
      );
      break;
    }
  }

  return guardNoteCreation(repository, config);
}
