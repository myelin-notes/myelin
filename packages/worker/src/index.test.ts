import { describe, expect, it } from 'vitest';
import { LiveDiscoveryRoom } from './index';

function createRoom(): LiveDiscoveryRoom {
  const data = new Map<string, unknown>();
  return new LiveDiscoveryRoom({
    storage: {
      get: async (key: string) => data.get(key),
      put: async (key: string, value: unknown) => {
        data.set(key, value);
      },
      delete: async (key: string) => data.delete(key),
      deleteAll: async () => data.clear(),
      list: async (options?: { prefix?: string }) =>
        new Map(
          [...data].filter(([key]) => key.startsWith(options?.prefix ?? '')),
        ),
    },
  } as never);
}

const URL_BASE = 'https://x.test/v1/rooms/room/records';

describe('live discovery room tokens', () => {
  it('rejects DELETE without the record token and hides the token from listings', async () => {
    const room = createRoom();
    const published = await room.fetch(
      new Request(URL_BASE, {
        method: 'POST',
        body: JSON.stringify({ recordId: 'r1', peerId: 'p', ticket: 't' }),
      }),
    );
    const { token } = (await published.json()) as { token: string };
    expect(token).toBeTruthy();

    const url = `${URL_BASE}/r1`;
    expect(
      (await room.fetch(new Request(url, { method: 'DELETE' }))).status,
    ).toBe(403);
    expect(
      (
        await room.fetch(
          new Request(url, {
            method: 'DELETE',
            headers: { 'X-Record-Token': 'nope' },
          }),
        )
      ).status,
    ).toBe(403);

    const listing = JSON.stringify(
      await (await room.fetch(new Request(URL_BASE))).json(),
    );
    expect(listing).toContain('"r1"');
    expect(listing).not.toContain(token);

    expect(
      (
        await room.fetch(
          new Request(url, {
            method: 'DELETE',
            headers: { 'X-Record-Token': token },
          }),
        )
      ).status,
    ).toBe(204);
  });
});
