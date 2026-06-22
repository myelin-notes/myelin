import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllThumbnails } from '@/lib/thumbnails';
import { setRepositoryConfig } from './repository-settings';

vi.mock('@/lib/thumbnails', () => ({
  clearAllThumbnails: vi.fn(async () => undefined),
}));

describe('setRepositoryConfig', () => {
  beforeEach(() => {
    vi.mocked(clearAllThumbnails).mockClear();
  });

  it('clears thumbnails when switching to a different repository', () => {
    setRepositoryConfig({
      kind: 'github',
      owner: 'octo',
      repo: 'notes',
      branch: 'main',
      credentialId: 'default',
    });

    expect(clearAllThumbnails).toHaveBeenCalledTimes(1);
  });

  it('does not clear thumbnails when the repository is unchanged', () => {
    setRepositoryConfig({ kind: 'local' });

    expect(clearAllThumbnails).not.toHaveBeenCalled();
  });

  it('does not clear thumbnails when only the credential changes', () => {
    setRepositoryConfig({
      kind: 'github',
      owner: 'octo',
      repo: 'notes',
      branch: 'main',
      credentialId: 'a',
    });
    vi.mocked(clearAllThumbnails).mockClear();

    setRepositoryConfig({
      kind: 'github',
      owner: 'octo',
      repo: 'notes',
      branch: 'main',
      credentialId: 'b',
    });

    expect(clearAllThumbnails).not.toHaveBeenCalled();
  });

  it('clears thumbnails when the branch changes', () => {
    setRepositoryConfig({
      kind: 'github',
      owner: 'octo',
      repo: 'notes',
      branch: 'main',
      credentialId: 'default',
    });
    vi.mocked(clearAllThumbnails).mockClear();

    setRepositoryConfig({
      kind: 'github',
      owner: 'octo',
      repo: 'notes',
      branch: 'dev',
      credentialId: 'default',
    });

    expect(clearAllThumbnails).toHaveBeenCalledTimes(1);
  });
});
