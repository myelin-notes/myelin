import { beforeEach, describe, expect, it } from 'vitest';
import { resetRepositoryTestDoubles } from '@/test/repository-test-utils';
import { LocalRepository } from './local';

/**
 * searchNodes caches the built MiniSearch index across queries; these tests pin
 * that the cache never serves stale results after the corpus changes.
 */
describe('searchNodes index cache', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  const ids = async (repository: LocalRepository, query: string) =>
    (await repository.searchNodes(query)).map((result) => result.node.id);

  it('reflects a rename after the index was already built for a prior query', async () => {
    const repository = new LocalRepository('repositories/search-cache-rename');
    await repository.initialize();
    const fileId = await repository.createFile('Alpha', 'mcanvas', null);

    // Populate the cache, then rename and confirm the stale name is gone.
    expect(await ids(repository, 'Alpha')).toEqual([fileId]);
    await repository.renameNode(fileId, 'Beta');

    expect(await ids(repository, 'Alpha')).toEqual([]);
    expect(await ids(repository, 'Beta')).toEqual([fileId]);
  });

  it('reflects newly created and deleted nodes across cached queries', async () => {
    const repository = new LocalRepository('repositories/search-cache-crud');
    await repository.initialize();
    const alpha = await repository.createFile('Alpha', 'mcanvas', null);

    expect(await ids(repository, 'Alpha')).toEqual([alpha]);

    const alphaTwo = await repository.createFile('Alpha two', 'mcanvas', null);
    expect((await ids(repository, 'Alpha')).sort()).toEqual(
      [alpha, alphaTwo].sort(),
    );

    await repository.deleteNode(alphaTwo);
    expect(await ids(repository, 'Alpha')).toEqual([alpha]);
  });
});
