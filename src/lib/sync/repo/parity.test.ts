import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCanvasNoteState,
  createNoteState,
  getRepositoryTestGoogleDriveApi,
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
        folderId: getRepositoryTestGoogleDriveApi().rootFolderId,
        credentialId: 'test-credential',
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
      await repository.addTag(rawFileId, 'uni/math');
      await repository.addCustomColor('#ABCDEF', 'pen');
      await repository.addCustomColor('#FACC15', 'highlighter');
      await repository.addCustomColor('#3B82F6', 'text');
      await repository.addRegistryTags(['alpha', 'orphan']);
      const [penPreset] = await repository.addPenPreset({
        tool: 'pen',
        color: '#ABCDEF',
        size: 12,
        inWheel: true,
      });
      await repository.addPenPreset({
        tool: 'highlighter',
        color: '#FACC15',
        size: 36,
        inWheel: false,
      });

      const [rootFolders, rootFiles] = await repository.listDirectory(null);
      const [, docsFiles] = await repository.listDirectory(folderId);

      expect(rootFolders.map((folder) => folder.id)).toEqual([folderId]);
      expect(rootFiles.map((file) => file.id)).toEqual([fileId]);
      expect(docsFiles.map((file) => file.id)).toEqual([rawFileId]);
      expect(
        (await repository.searchNodes('Renamed')).map(
          (result) => result.node.id,
        ),
      ).toEqual([fileId]);
      expect(
        (await repository.getNodesByAnyTag(['alpha']))
          .map((node) => node.id)
          .sort(),
      ).toEqual([fileId, rawFileId].sort());
      expect(
        (await repository.getNodesByAnyTag(['uni'])).map((node) => node.id),
      ).toEqual([rawFileId]);
      expect(
        (await repository.getNodesByAnyTag(['uni/math'])).map(
          (node) => node.id,
        ),
      ).toEqual([rawFileId]);
      expect(await repository.getNodesByAnyTag(['unique'])).toEqual([]);
      expect(await repository.getNodesByAnyTag(['uni/ma'])).toEqual([]);
      expect(
        (await repository.listTags()).map((tag) => tag.tag).sort(),
      ).toEqual(['alpha', 'uni/math']);

      const hierarchicalTags = await repository.listTags(true);
      const hierarchicalByTag = new Map(
        hierarchicalTags.map((entry) => [entry.tag, entry.count]),
      );
      expect(hierarchicalByTag.has('alpha')).toBe(true);
      expect(hierarchicalByTag.has('uni')).toBe(true);
      expect(hierarchicalByTag.has('uni/math')).toBe(true);
      expect(hierarchicalByTag.get('uni')).toBe(
        (await repository.getNodesByAnyTag(['uni'])).length,
      );
      expect(await repository.getCustomColors('pen')).toEqual(['#abcdef']);
      expect(await repository.getCustomColors('highlighter')).toEqual([
        '#facc15',
      ]);
      expect(await repository.getCustomColors('text')).toEqual(['#3b82f6']);
      expect((await repository.getRegistryTags()).sort()).toEqual([
        'alpha',
        'orphan',
      ]);
      expect(await repository.getPenPresets()).toEqual([
        {
          id: penPreset.id,
          tool: 'pen',
          color: '#abcdef',
          size: 12,
          inWheel: true,
        },
        expect.objectContaining({
          tool: 'highlighter',
          color: '#facc15',
          size: 36,
          inWheel: false,
        }),
      ]);
      expect(
        Array.from((await repository.readFileBytes(rawFileId)) ?? []),
      ).toEqual([4, 5]);

      const graphSourceId = await repository.createFile(
        'Graph Source',
        'mcanvas',
        null,
      );
      const graphTargetId = await repository.createFile(
        'Graph Target',
        'mcanvas',
        null,
      );
      const graphNote = await createCanvasNoteState(
        'See [[Graph Target]].',
        async (title) => (title === 'Graph Target' ? graphTargetId : null),
      );
      await repository.pushUpdates(graphSourceId, graphNote.update, {
        baseRevision: null,
        localStateVector: graphNote.stateVector,
      });

      expect(
        (await repository.getNoteGraph()).nodes.map((node) => node.id).sort(),
      ).toEqual([fileId, graphSourceId, graphTargetId].sort());
      expect(await repository.getNoteGraph()).toMatchObject({
        links: [
          {
            sourceId: graphSourceId,
            targetId: graphTargetId,
            title: 'Graph Target',
          },
        ],
      });

      await repository.removeCustomColor('#abcdef', 'pen');
      await repository.removeCustomColor('#facc15', 'highlighter');
      await repository.removeCustomColor('#3b82f6', 'text');
      await repository.removeRegistryTag('orphan');
      await repository.updatePenPreset(penPreset.id, { size: 20 });
      const remainingPresets = await repository.getPenPresets();
      await repository.removePenPreset(remainingPresets[1].id);
      await repository.deleteNode(folderId);

      expect(await repository.getNode(folderId)).toBeNull();
      expect(await repository.getNode(rawFileId)).toBeNull();
      expect(await repository.getCustomColors('pen')).toEqual([]);
      expect(await repository.getCustomColors('highlighter')).toEqual([]);
      expect(await repository.getCustomColors('text')).toEqual([]);
      expect(await repository.getRegistryTags()).toEqual(['alpha']);
      expect(await repository.getPenPresets()).toEqual([
        {
          id: penPreset.id,
          tool: 'pen',
          color: '#abcdef',
          size: 20,
          inWheel: true,
        },
      ]);
    });
  }
});
