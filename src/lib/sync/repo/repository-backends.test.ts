import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryConfig } from './config';
import { hasGitHubToken } from './github/credentials';
import { hasGoogleDriveToken } from './google-drive/credentials';
import { BACKENDS, normalizeRepositoryConfig } from './repository-backends';

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

  it('keeps every backend on the same contract', async () => {
    expect(Object.keys(BACKENDS).sort()).toEqual(
      Object.keys(contractCases).sort(),
    );

    for (const [kind, backend] of Object.entries(BACKENDS)) {
      const contractCase = contractCases[kind as RepositoryConfig['kind']];

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
