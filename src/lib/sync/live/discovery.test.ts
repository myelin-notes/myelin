import { describe, expect, it } from 'vitest';
import {
  createLiveDiscoveryRoomId,
  getLiveDiscoveryRepositoryKey,
  parseLiveDiscoveryRecords,
} from './discovery';

describe('live discovery records', () => {
  it('parses valid records and drops malformed entries', () => {
    expect(
      parseLiveDiscoveryRecords({
        records: [
          {
            recordId: 'record-a',
            peerId: 'peer-a',
            ticket: 'ticket-a',
            updatedAt: 1,
            expiresAt: 2,
          },
          {
            recordId: 'missing-ticket',
            peerId: 'peer-b',
            updatedAt: 1,
            expiresAt: 2,
          },
        ],
      }),
    ).toEqual([
      {
        recordId: 'record-a',
        peerId: 'peer-a',
        ticket: 'ticket-a',
        updatedAt: 1,
        expiresAt: 2,
      },
    ]);
  });
});

describe('live discovery room ids', () => {
  it('derives no room for local repositories', async () => {
    expect(getLiveDiscoveryRepositoryKey({ kind: 'local' })).toBeNull();
    await expect(
      createLiveDiscoveryRoomId({ kind: 'local' }, 'secret', 'note-1'),
    ).resolves.toBeNull();
  });

  it('changes with the repository secret and not with credentials', async () => {
    const config = {
      kind: 'github',
      owner: 'o',
      repo: 'r',
      branch: undefined,
      credentialId: 'credential-a',
    } as const;
    const first = await createLiveDiscoveryRoomId(config, 'secret-a', 'note-1');
    const sameSecret = await createLiveDiscoveryRoomId(
      { ...config, credentialId: 'credential-b' },
      'secret-a',
      'note-1',
    );
    const otherSecret = await createLiveDiscoveryRoomId(
      config,
      'secret-b',
      'note-1',
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(sameSecret);
    expect(first).not.toBe(otherSecret);
  });
});
