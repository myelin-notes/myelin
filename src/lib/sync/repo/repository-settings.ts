import { clearAllThumbnails } from '@myelin/editor/thumbnails';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { Logger } from '@myelin/shared/logger';
import type { RepositoryConfig } from './config';
import {
  getRepositoryStorageKey,
  normalizeRepositoryConfig,
} from './repository-backends';

const logger = new Logger('RepositorySettings');

export function getRepositoryConfig(): RepositoryConfig {
  return normalizeRepositoryConfig(UserPrefs.get('repositoryConfig'));
}

export function setRepositoryConfig(config: RepositoryConfig): void {
  const next = normalizeRepositoryConfig(config);
  const switched =
    getRepositoryStorageKey(next) !==
    getRepositoryStorageKey(getRepositoryConfig());
  UserPrefs.set('repositoryConfig', next);
  if (switched) {
    // Thumbnails are cached by node ID with no repo namespace; clear them on
    // switch so the old repo's entries don't orphan on disk.
    void clearAllThumbnails().catch((err) => {
      logger.error('Failed to clear thumbnails on repository switch', err);
    });
  }
}

export function subscribeRepositoryConfig(
  fn: (config: RepositoryConfig) => void,
): () => void {
  return UserPrefs.subscribe('repositoryConfig', (config) => {
    fn(normalizeRepositoryConfig(config));
  });
}
