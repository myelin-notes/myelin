import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepository } from './factory';
import { hasGitHubToken } from './github-credentials';
import {
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
  RepositorySetupIncompleteError,
} from './readiness';

const mockHasGitHubToken = vi.mocked(hasGitHubToken);
describe('repository readiness', () => {
  beforeEach(() => {
    mockHasGitHubToken.mockClear();
    mockHasGitHubToken.mockResolvedValue(true);
  });

  it('treats GitHub configs without repository details as incomplete', async () => {
    const config = {
      kind: 'github',
      owner: '',
      repo: '',
      branch: 'main',
      credentialId: 'default',
    } as const;

    expect(isRepositoryConfigStructurallyComplete(config)).toBe(false);
    await expect(isRepositoryFullyConfigured(config)).resolves.toBe(false);
    expect(mockHasGitHubToken).not.toHaveBeenCalled();
  });

  it('requires credentials for remote repositories', async () => {
    mockHasGitHubToken.mockResolvedValue(false);

    await expect(
      isRepositoryFullyConfigured({
        kind: 'github',
        owner: 'myelin',
        repo: 'notes',
        branch: 'main',
        credentialId: 'work',
      }),
    ).resolves.toBe(false);

    expect(mockHasGitHubToken).toHaveBeenCalledWith('work');
  });

  it('blocks canvas creation when the selected repository is incomplete', async () => {
    const repository = createRepository({
      kind: 'github',
      owner: '',
      repo: '',
      branch: 'main',
      credentialId: 'default',
    });

    await expect(
      repository.createFile('Untitled Canvas', 'mcanvas', null),
    ).rejects.toBeInstanceOf(RepositorySetupIncompleteError);
  });
});
