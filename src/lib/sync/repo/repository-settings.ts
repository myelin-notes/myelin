import { UserPrefs } from '@/lib/user-prefs';
import { DEFAULT_REPOSITORY_CONFIG, type RepositoryConfig } from './config';

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
    case 'googleDrive':
      return {
        kind: 'googleDrive',
        credentialId: config.credentialId.trim() || 'default',
      };
  }
}

export function getRepositoryConfig(): RepositoryConfig {
  return normalizeRepositoryConfig(UserPrefs.get('repositoryConfig'));
}

export function setRepositoryConfig(config: RepositoryConfig): void {
  UserPrefs.set('repositoryConfig', normalizeRepositoryConfig(config));
}

export function subscribeRepositoryConfig(
  fn: (config: RepositoryConfig) => void,
): () => void {
  return UserPrefs.subscribe('repositoryConfig', (config) => {
    fn(normalizeRepositoryConfig(config));
  });
}
