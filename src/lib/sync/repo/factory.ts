import { CachedRepository } from './cached';
import type { ActiveRepository, RepositoryConfig } from './config';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';
import {
  isRepositoryFullyConfigured,
  RepositorySetupIncompleteError,
} from './readiness';
import type { FileType } from './types';

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
        ) => {
          if (
            fileType === 'mcanvas' &&
            !(await isRepositoryFullyConfigured(config))
          ) {
            throw new RepositorySetupIncompleteError();
          }

          return target.createFile(name, fileType, parentId, bytes);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ActiveRepository;
}

export function getStorageRoot(config: RepositoryConfig): string {
  switch (config.kind) {
    case 'local':
      return '';
    case 'github':
      return `repositories/github/${getGitHubStorageKey(config)}`;
  }
}

export function createRepository(config: RepositoryConfig): ActiveRepository {
  let repository: ActiveRepository;

  switch (config.kind) {
    case 'local': {
      repository = new LocalRepository();
      break;
    }
    case 'github': {
      const cacheRoot = getStorageRoot(config);
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
