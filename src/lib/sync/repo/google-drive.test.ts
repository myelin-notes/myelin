import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGoogleDriveApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { GoogleDriveRepository } from './google-drive';
import { createEmptyManifest } from './shared';

function createRepository() {
  return new GoogleDriveRepository({
    credentialId: 'test-drive-credential',
  });
}

describe('GoogleDriveRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('initializes a missing manifest as an empty repository', async () => {
    const repository = createRepository();
    const driveApi = getRepositoryTestGoogleDriveApi();

    const stats = await repository.getStats();

    expect(stats).toEqual({
      totalFiles: 0,
      totalFolders: 0,
      totalTags: 0,
    });

    const manifestFile = driveApi.readFileByAppProperty(
      'myelin_role',
      'manifest',
    );
    expect(manifestFile).not.toBeNull();
    const manifestBytes = manifestFile
      ? driveApi.readBytes(manifestFile.id)
      : null;
    expect(
      JSON.parse(new TextDecoder().decode(manifestBytes ?? new Uint8Array())),
    ).toEqual(createEmptyManifest());
  });

  it('creates a Drive folder, manifest, and note content through the transport', async () => {
    const repository = createRepository();
    const driveApi = getRepositoryTestGoogleDriveApi();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile(
      'Remote note',
      'mcanvas',
      folderId,
    );
    const note = createNoteState('hello google drive repository');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const rootFolder = driveApi.readFileByAppProperty('myelin_repository', '1');
    const manifestFile = driveApi.readFileByAppProperty(
      'myelin_role',
      'manifest',
    );
    const noteFile = driveApi.readFileByAppProperty('myelin_note_id', fileId);

    expect(rootFolder?.name).toBe('Myelin');
    expect(manifestFile).not.toBeNull();
    expect(noteFile?.name).toBe(`${fileId}.myelin`);

    const manifestBytes = manifestFile
      ? driveApi.readBytes(manifestFile.id)
      : null;
    expect(manifestBytes).not.toBeNull();
    const manifest = JSON.parse(
      new TextDecoder().decode(manifestBytes ?? new Uint8Array()),
    ) as {
      nodes: Record<string, { name: string; parentId: string | null }>;
    };

    expect(manifest.nodes[folderId]?.name).toBe('Docs');
    expect(manifest.nodes[fileId]?.parentId).toBe(folderId);
    expect(
      readNoteText(noteFile ? driveApi.readBytes(noteFile.id) : null),
    ).toBe('hello google drive repository');
  });

  it('stores image file bytes with image metadata through the transport', async () => {
    const repository = createRepository();
    const driveApi = getRepositoryTestGoogleDriveApi();
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const fileId = await repository.createFile('Photo.png', 'png', null, bytes);

    const file = driveApi.readFileByAppProperty('myelin_note_id', fileId);

    expect(file?.name).toBe(`${fileId}.png`);
    expect(file?.mimeType).toBe('image/png');
    expect(Array.from(file ? (driveApi.readBytes(file.id) ?? []) : [])).toEqual(
      Array.from(bytes),
    );
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(bytes),
    );
  });
});
