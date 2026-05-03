import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNoteState,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import type { BaseRepository } from './base';
import { GitHubRepository } from './github';
import { GoogleDriveRepository } from './google-drive';
import { LocalRepository } from './local';

const repositoryCases: {
  name: string;
  createRepository: (label: string) => BaseRepository;
}[] = [
  {
    name: 'local',
    createRepository: (label) => new LocalRepository(`repositories/${label}`),
  },
  {
    name: 'github',
    createRepository: (label) =>
      new GitHubRepository({
        owner: 'myelin',
        repo: label,
        branch: 'main',
        credentialId: 'test-credential',
      }),
  },
  {
    name: 'google-drive',
    createRepository: () =>
      new GoogleDriveRepository({
        credentialId: 'test-drive-credential',
      }),
  },
];

describe('Repository business logic parity', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.useRealTimers();
  });

  for (const { name, createRepository } of repositoryCases) {
    it(`${name} follows the shared VFS behavior`, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const repository = createRepository(`parity-${name}`);
      await repository.initialize();

      const folderId = await repository.createFolder('Docs', null);
      const fileId = await repository.createFile('Note', 'mcanvas', folderId);
      const rawFileId = await repository.createFile(
        'Photo.png',
        'png',
        folderId,
        new Uint8Array([1, 2, 3]),
      );
      const createdFile = await repository.getNode(fileId);

      expect(createdFile).toMatchObject({
        id: fileId,
        name: 'Note',
        type: 'file',
        parentId: folderId,
      });
      const createdModifiedAt = createdFile?.modifiedAt ?? 0;

      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
      const note = createNoteState('hello parity');
      const pushResult = await repository.pushUpdates(fileId, note.update, {
        baseRevision: null,
        localStateVector: note.stateVector,
      });

      const savedFile = await repository.getNode(fileId);
      expect(pushResult.accepted).toBe(true);
      expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
        'hello parity',
      );
      expect(savedFile?.modifiedAt).toBeGreaterThan(createdModifiedAt);
      expect(
        Array.from((await repository.readFileBytes(rawFileId)) ?? []),
      ).toEqual([1, 2, 3]);

      await repository.writeFileBytes(rawFileId, new Uint8Array([4, 5]));
      await repository.renameNode(fileId, 'Renamed note');
      await repository.moveNode(fileId, null);
      await repository.setTags(fileId, ['alpha']);
      await repository.addTag(rawFileId, 'alpha');
      await repository.addTag(rawFileId, 'beta');
      await repository.removeTag(rawFileId, 'beta');
      await repository.addCustomColor('#ABCDEF');

      const [rootFolders, rootFiles] = await repository.listDirectory(null);
      const [, docsFiles] = await repository.listDirectory(folderId);

      expect(rootFolders.map((folder) => folder.id)).toEqual([folderId]);
      expect(rootFiles.map((file) => file.id)).toEqual([fileId]);
      expect(docsFiles.map((file) => file.id)).toEqual([rawFileId]);
      expect(
        (await repository.searchNodes('Renamed')).map((node) => node.id),
      ).toEqual([fileId]);
      expect(
        (await repository.getNodesByAnyTag(['alpha']))
          .map((node) => node.id)
          .sort(),
      ).toEqual([fileId, rawFileId].sort());
      expect(
        (await repository.listTags()).map((tag) => tag.tag).sort(),
      ).toEqual(['alpha']);
      expect(await repository.getCustomColors()).toEqual(['#abcdef']);
      expect(
        Array.from((await repository.readFileBytes(rawFileId)) ?? []),
      ).toEqual([4, 5]);

      await repository.removeCustomColor('#abcdef');
      await repository.deleteNode(folderId);

      expect(await repository.getNode(folderId)).toBeNull();
      expect(await repository.getNode(rawFileId)).toBeNull();
      expect(await repository.getCustomColors()).toEqual([]);
    });
  }
});
