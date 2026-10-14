import { beforeEach, expect, it, vi } from 'vitest';
import { fetch } from '@tauri-apps/plugin-http';
import { ensureGoogleDriveFolder, renameGoogleDriveFolder } from './folders';

beforeEach(() => {
  vi.mocked(fetch).mockReset();
});

it('reuses an existing app folder and renames it without changing its ID', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({ files: [{ id: 'existing', name: 'Notes' }] }),
    )
    .mockResolvedValueOnce(Response.json({ id: 'existing' }));
  expect(await ensureGoogleDriveFolder('account', ' Notes ')).toBe('existing');
  const lookup = new URL(vi.mocked(fetch).mock.calls[0][0].toString());
  expect(lookup.searchParams.get('q')).toBe(
    "'root' in parents and name = 'Notes' and trashed = false and mimeType = 'application/vnd.google-apps.folder'",
  );
  await renameGoogleDriveFolder('account', 'existing', ' Renamed ');
  expect(fetch).toHaveBeenLastCalledWith(
    'https://www.googleapis.com/drive/v3/files/existing',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed' }),
      headers: expect.objectContaining({
        Authorization: 'Bearer test-drive-token',
      }),
    }),
  );
});

it('creates a missing folder with the app scope and rejects empty names before writing', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ files: [] }))
    .mockResolvedValueOnce(Response.json({ id: 'created' }));
  expect(await ensureGoogleDriveFolder('account', 'Notes')).toBe('created');
  expect(fetch).toHaveBeenLastCalledWith(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: 'Notes',
        parents: ['root'],
        mimeType: 'application/vnd.google-apps.folder',
      }),
    }),
  );
  await expect(ensureGoogleDriveFolder('account', ' ')).rejects.toThrow(
    'empty',
  );
  await expect(
    renameGoogleDriveFolder('account', 'created', ' '),
  ).rejects.toThrow('empty');
  expect(fetch).toHaveBeenCalledTimes(2);
});
