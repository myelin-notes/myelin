import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryConfig } from './config';
import { hasGitHubToken } from './github-credentials';
import { hasGoogleDriveToken } from './google-drive-credentials';
import {
  createRepositoryBackendRegistry,
  getRepositoryBackends,
  normalizeRepositoryConfig,
  type RepositoryBackendDescriptor,
} from './repository-backends';

interface BackendContractCase {
  config: RepositoryConfig;
  normalizedConfig: RepositoryConfig;
  storageKey: string;
  configIdentity: string;
  discoveryKey: string | null;
}

const contractCases: Record<RepositoryConfig['kind'], BackendContractCase> = {
  local: {
    config: { kind: 'local' },
    normalizedConfig: { kind: 'local' },
    storageKey: 'local',
    configIdentity: 'local',
    discoveryKey: null,
  },
  github: {
    config: {
      kind: 'github',
      owner: ' Myelin ',
      repo: ' notes/path ',
      branch: undefined,
      credentialId: ' work ',
    },
    normalizedConfig: {
      kind: 'github',
      owner: 'Myelin',
      repo: 'notes/path',
      branch: 'main',
      credentialId: 'work',
    },
    storageKey: 'Myelin__notes_path__main',
    configIdentity: 'github\0 Myelin \0 notes/path \0\0 work ',
    discoveryKey: 'github\0myelin\0notes/path\0main',
  },
  'google-drive': {
    config: {
      kind: 'google-drive',
      folderName: ' Myelin ',
      folderId: ' folder-id ',
      credentialId: ' work ',
    },
    normalizedConfig: {
      kind: 'google-drive',
      folderName: 'Myelin',
      folderId: 'folder-id',
      credentialId: 'work',
    },
    storageKey: 'folder-id',
    configIdentity: 'google-drive\0 folder-id \0 work ',
    discoveryKey: 'google-drive\0folder-id',
  },
};

describe('repository backend descriptors', () => {
  beforeEach(() => {
    vi.mocked(hasGitHubToken).mockClear();
    vi.mocked(hasGitHubToken).mockResolvedValue(true);
    vi.mocked(hasGoogleDriveToken).mockClear();
    vi.mocked(hasGoogleDriveToken).mockResolvedValue(true);
  });

  it('keeps every registered backend on the same contract', async () => {
    const backends = getRepositoryBackends();

    expect(backends.map((backend) => backend.kind).sort()).toEqual(
      Object.keys(contractCases).sort(),
    );

    for (const backend of backends) {
      const contractCase = contractCases[backend.kind];

      expect(backend.normalizeConfig(contractCase.config)).toEqual(
        contractCase.normalizedConfig,
      );
      expect(backend.storageKey(contractCase.config)).toBe(
        contractCase.storageKey,
      );
      expect(backend.configIdentity(contractCase.config)).toBe(
        contractCase.configIdentity,
      );
      expect(backend.discoveryKey(contractCase.config)).toBe(
        contractCase.discoveryKey,
      );
      expect(backend.isStructurallyComplete(contractCase.config)).toBe(true);
      await expect(
        backend.isFullyConfigured(contractCase.config),
      ).resolves.toBe(true);
    }
  });

  it('registers a test backend without a central switch', () => {
    interface TestRepositoryConfig {
      kind: 'test';
      id: string;
    }

    const descriptor: RepositoryBackendDescriptor<TestRepositoryConfig> = {
      kind: 'test',
      create: () => {
        throw new Error('The test descriptor does not create repositories.');
      },
      normalizeConfig: (config) => config,
      storageKey: (config) => config.id,
      configIdentity: (config) => config.id,
      discoveryKey: (config) => config.id,
      isStructurallyComplete: (config) => config.id.length > 0,
      isFullyConfigured: async (config) => config.id.length > 0,
    };
    const registry = createRepositoryBackendRegistry<TestRepositoryConfig>();
    const config: TestRepositoryConfig = { kind: 'test', id: 'test-1' };

    registry.register(descriptor);

    expect(registry.get(config).storageKey(config)).toBe('test-1');
  });

  it("uses each backend's defaults while normalizing config", () => {
    expect(
      normalizeRepositoryConfig({
        kind: 'github',
        owner: 'owner',
        repo: 'repo',
        credentialId: '',
      }),
    ).toEqual({
      kind: 'github',
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      credentialId: 'default',
    });
    expect(
      normalizeRepositoryConfig({
        kind: 'google-drive',
        folderName: '',
        folderId: 'folder-id',
        credentialId: '',
      }),
    ).toEqual({
      kind: 'google-drive',
      folderName: 'Myelin',
      folderId: 'folder-id',
      credentialId: 'default',
    });
  });
});
