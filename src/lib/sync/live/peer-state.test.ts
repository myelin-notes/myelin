import { describe, expect, it } from 'vitest';
import { PeerState } from './peer-state';
import type { PeerControlMessage } from './protocol';

function hello(peerId: string): PeerControlMessage {
  return {
    type: 'peer',
    peerId,
    kind: 'hello',
    mode: 'owner-device',
  };
}

describe('PeerState', () => {
  it('stores connected peers in the snapshot', () => {
    const state = new PeerState('peer-local', 'owner-device');

    state.applyMessage(hello('peer-a'), 0);

    expect(state.getSnapshot().connectedPeers).toEqual([
      { peerId: 'peer-a', mode: 'owner-device' },
    ]);
  });
});
