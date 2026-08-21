import { Logger } from '@/lib/logger';
import { clearAllThumbnails } from '@/lib/thumbnails';
import { UserPrefs } from '@/lib/user-prefs';
import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  DEFAULT_REPOSITORY_CONFIG,
  getRepositoryStorageKey,
  type RepositoryConfig,
} from './config';

const logger = new Logger('RepositorySettings');

function normalizeRepositoryConfig(config: RepositoryConfig): RepositoryConfig {
  switch (config.kind) {
    case 'local':
      return DEFAULT_REPOSITORY_CONFIG;
    case 'github':
      return {
        kind: 'github',
        owner: config.owner.trim(),
        repo: config.repo.trim(),
        branch: config.branch?.trim() || 'main',
        credentialId: config.credentialId.trim() || 'default',
      };
    case 'google-drive':
      return {
        kind: 'google-drive',
        folderName:
          config.folderName.trim() || DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
        folderId: config.folderId.trim(),
        credentialId: config.credentialId.trim() || 'default',
      };
  }
}

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
