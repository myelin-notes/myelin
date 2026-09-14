import {
  DEFAULT_GOOGLE_DRIVE_FOLDER_NAME,
  type RepositoryConfig,
} from '@myelin/editor/sync/repo/config';
import { CachedRepository } from './cached';
import type { ActiveRepository } from './config';
import { GitHubRepository } from './github';
import { hasGitHubToken } from './github-credentials';
import { GoogleDriveRepository } from './google-drive';
import { hasGoogleDriveToken } from './google-drive-credentials';
import { LocalRepository } from './local';

interface RepositoryConfigBase {
  kind: string;
}

export interface RepositoryBackendDescriptor<
  Config extends RepositoryConfigBase,
> {
  readonly kind: Config['kind'];
  create(config: Config): ActiveRepository;
  normalizeConfig(config: Config): Config;
  storageKey(config: Config): string;
  configIdentity(config: Config): string;
  discoveryKey(config: Config): string | null;
  isStructurallyComplete(config: Config): boolean;
  isFullyConfigured(config: Config): Promise<boolean>;
}

export class RepositoryBackendRegistry<Config extends RepositoryConfigBase> {
  private readonly descriptors = new Map<
    Config['kind'],
    RepositoryBackendDescriptor<Config>
  >();

  register(descriptor: RepositoryBackendDescriptor<Config>): void {
    if (this.descriptors.has(descriptor.kind)) {
      throw new Error(
        `Repository backend already registered: ${descriptor.kind}`,
      );
    }
    this.descriptors.set(descriptor.kind, descriptor);
  }

  get(config: Config): RepositoryBackendDescriptor<Config> {
    const descriptor = this.descriptors.get(config.kind);
    if (!descriptor) {
      throw new Error(`No repository backend registered: ${config.kind}`);
    }
    return descriptor;
  }

  values(): readonly RepositoryBackendDescriptor<Config>[] {
    return [...this.descriptors.values()];
  }
}

export function createRepositoryBackendRegistry<
  Config extends RepositoryConfigBase,
>(
  descriptors: readonly RepositoryBackendDescriptor<Config>[] = [],
): RepositoryBackendRegistry<Config> {
  const registry = new RepositoryBackendRegistry<Config>();
  for (const descriptor of descriptors) {
    registry.register(descriptor);
  }
  return registry;
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
    kind: 'local',
    create: () => new LocalRepository(),
    normalizeConfig: () => ({ kind: 'local' }),
    storageKey: () => 'local',
    configIdentity: () => 'local',
    discoveryKey: () => null,
    isStructurallyComplete: () => true,
    isFullyConfigured: async () => true,
  };

const githubRepositoryBackend: RepositoryBackendDescriptor<GitHubRepositoryConfig> =
  {
    kind: 'github',
    create: (config) => {
      const cacheRoot = `repositories/github/${getRepositoryStorageKey(config)}`;
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
    kind: 'google-drive',
    create: (config) => {
      const cacheRoot = `repositories/google-drive/${getRepositoryStorageKey(config)}`;
      return new CachedRepository(
        new GoogleDriveRepository({
          folderId: config.folderId,
          credentialId: config.credentialId,
        }),
        new LocalRepository(cacheRoot),
        `${cacheRoot}/outbox.json`,
      );
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

const repositoryBackendRegistry =
  createRepositoryBackendRegistry<RepositoryConfig>([
    localRepositoryBackend,
    githubRepositoryBackend,
    googleDriveRepositoryBackend,
  ]);

export function getRepositoryBackends(): readonly RepositoryBackendDescriptor<RepositoryConfig>[] {
  return repositoryBackendRegistry.values();
}

export function getRepositoryBackend(
  config: RepositoryConfig,
): RepositoryBackendDescriptor<RepositoryConfig> {
  return repositoryBackendRegistry.get(config);
}

export function createRepositoryFromConfig(
  config: RepositoryConfig,
): ActiveRepository {
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
