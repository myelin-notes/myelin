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
      createLiveDiscoveryRoomId({ kind: 'local' }, 'note-1'),
    ).resolves.toBeNull();
  });

  it('normalizes GitHub repository identity before hashing', async () => {
    const first = await createLiveDiscoveryRoomId(
      {
        kind: 'github',
        owner: 'Myelin-Notes',
        repo: 'Myelin',
        branch: undefined,
        credentialId: 'credential-a',
      },
      'note-1',
    );
    const second = await createLiveDiscoveryRoomId(
      {
        kind: 'github',
        owner: 'myelin-notes',
        repo: 'myelin',
        branch: 'main',
        credentialId: 'credential-b',
      },
      'note-1',
    );

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).toBe(second);
  });
});
