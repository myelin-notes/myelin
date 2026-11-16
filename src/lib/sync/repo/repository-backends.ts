import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  type RepositoryConfig,
} from '@myelin/editor/sync/repo/config';
import { getGitHubToken, hasGitHubToken } from './github/credentials';
import {
  getGoogleDriveToken,
  hasGoogleDriveToken,
} from './google-drive/credentials';
import { NativeRepository } from './native';

export const REPOSITORY_SETUP_INCOMPLETE_MESSAGE =
  'Finish repository setup in Settings before creating notes.';

export class RepositorySetupIncompleteError extends Error {
  constructor() {
    super(REPOSITORY_SETUP_INCOMPLETE_MESSAGE);
    this.name = 'RepositorySetupIncompleteError';
  }
}

interface RepositoryBackendDescriptor<Config extends RepositoryConfig> {
  create(config: Config): NativeRepository;
  normalizeConfig(config: Config): Config;
  storageKey(config: Config): string;
  configIdentity(config: Config): string;
  discoveryKey(config: Config): string | null;
  isStructurallyComplete(config: Config): boolean;
  isFullyConfigured(config: Config): Promise<boolean>;
}

type LocalRepositoryConfig = Extract<RepositoryConfig, { kind: 'local' }>;
type GitHubRepositoryConfig = Extract<RepositoryConfig, { kind: 'github' }>;
type GoogleDriveRepositoryConfig = Extract<
  RepositoryConfig,
  { kind: 'google-drive' }
>;

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function normalizeStorageKeyPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_') || 'default';
}

const localRepositoryBackend: RepositoryBackendDescriptor<LocalRepositoryConfig> =
  {
    create: () =>
      new NativeRepository({
        kind: 'local-storage',
        storageRoot: '',
        source: null,
        canCreateNotes: async () => true,
      }),
    normalizeConfig: () => ({ kind: 'local' }),
    storageKey: () => 'local',
    configIdentity: () => 'local',
    discoveryKey: () => null,
    isStructurallyComplete: () => true,
    isFullyConfigured: async () => true,
  };

const githubRepositoryBackend: RepositoryBackendDescriptor<GitHubRepositoryConfig> =
  {
    create: (config) => {
      const cacheRoot = `repositories/github/${getRepositoryStorageKey(config)}`;
      return new NativeRepository({
        kind: 'github',
        storageRoot: cacheRoot,
        credentialId: config.credentialId,
        source: {
          kind: 'github',
          owner: config.owner,
          repo: config.repo,
          branch: config.branch ?? 'main',
        },
        getToken: (forceRefresh) =>
          getGitHubToken(config.credentialId, { forceRefresh }),
        canCreateNotes: () => isRepositoryFullyConfigured(config),
      });
    },
    normalizeConfig: (config) => ({
      kind: 'github',
      owner: config.owner.trim(),
      repo: config.repo.trim(),
      branch: config.branch?.trim() || 'main',
      credentialId: config.credentialId.trim() || 'default',
    }),
    storageKey: (config) =>
      [
        normalizeStorageKeyPart(config.owner),
        normalizeStorageKeyPart(config.repo),
        normalizeStorageKeyPart(config.branch ?? 'main'),
      ].join('__'),
    configIdentity: (config) =>
      [
        'github',
        config.owner,
        config.repo,
        config.branch ?? '',
        config.credentialId,
      ].join('\0'),
    discoveryKey: (config) =>
      [
        'github',
        config.owner.trim().toLowerCase(),
        config.repo.trim().toLowerCase(),
        (config.branch?.trim() || 'main').toLowerCase(),
      ].join('\0'),
    isStructurallyComplete: (config) =>
      hasText(config.owner) &&
      hasText(config.repo) &&
      hasText(config.branch ?? 'main'),
    isFullyConfigured: (config) => hasGitHubToken(config.credentialId),
  };

const googleDriveRepositoryBackend: RepositoryBackendDescriptor<GoogleDriveRepositoryConfig> =
  {
    create: (config) => {
      const cacheRoot = `repositories/google-drive/${getRepositoryStorageKey(config)}`;
      return new NativeRepository({
        kind: 'google-drive',
        storageRoot: cacheRoot,
        credentialId: config.credentialId,
        source: { kind: 'google-drive', folderId: config.folderId },
        getToken: (forceRefresh) =>
          getGoogleDriveToken(config.credentialId, { forceRefresh }),
        canCreateNotes: () => isRepositoryFullyConfigured(config),
      });
    },
    normalizeConfig: (config) => ({
      kind: 'google-drive',
      folderName: config.folderName.trim() || DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
      folderId: config.folderId.trim(),
      credentialId: config.credentialId.trim() || 'default',
    }),
    storageKey: (config) => normalizeStorageKeyPart(config.folderId),
    configIdentity: (config) =>
      ['google-drive', config.folderId, config.credentialId].join('\0'),
    discoveryKey: (config) =>
      ['google-drive', config.folderId.trim()].join('\0'),
    isStructurallyComplete: (config) =>
      hasText(config.folderName) && hasText(config.folderId),
    isFullyConfigured: (config) => hasGoogleDriveToken(config.credentialId),
  };

export const BACKENDS: Record<
  RepositoryConfig['kind'],
  RepositoryBackendDescriptor<RepositoryConfig>
> = {
  local: localRepositoryBackend,
  github: githubRepositoryBackend,
  'google-drive': googleDriveRepositoryBackend,
};

function getRepositoryBackend(
  config: RepositoryConfig,
): RepositoryBackendDescriptor<RepositoryConfig> {
  return BACKENDS[config.kind];
}

export function createRepository(config: RepositoryConfig): NativeRepository {
  return getRepositoryBackend(config).create(config);
}

export function normalizeRepositoryConfig(
  config: RepositoryConfig,
): RepositoryConfig {
  return getRepositoryBackend(config).normalizeConfig(config);
}

export function getRepositoryStorageKey(config: RepositoryConfig): string {
  return getRepositoryBackend(config).storageKey(config);
}

export function getRepositoryConfigIdentity(config: RepositoryConfig): string {
  return getRepositoryBackend(config).configIdentity(config);
}

export function getLiveDiscoveryRepositoryKey(
  config: RepositoryConfig,
): string | null {
  return getRepositoryBackend(config).discoveryKey(config);
}

export function isRepositoryConfigStructurallyComplete(
  config: RepositoryConfig,
): boolean {
  return getRepositoryBackend(config).isStructurallyComplete(config);
}

export async function isRepositoryFullyConfigured(
  config: RepositoryConfig,
): Promise<boolean> {
  if (!isRepositoryConfigStructurallyComplete(config)) {
    return false;
  }

  try {
    return await getRepositoryBackend(config).isFullyConfigured(config);
  } catch {
    return false;
  }
}
