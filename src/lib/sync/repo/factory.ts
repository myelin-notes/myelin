import type { ActiveRepository, RepositoryConfig } from './config';
import {
  isRepositoryFullyConfigured,
  RepositorySetupIncompleteError,
} from './readiness';
import { createRepositoryFromConfig } from './repository-backends';
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
  return guardNoteCreation(createRepositoryFromConfig(config), config);
}
