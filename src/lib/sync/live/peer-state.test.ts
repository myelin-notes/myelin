import { describe, expect, it } from 'vitest';
import { PeerState } from './peer-state';
import type { PeerControlMessage, PeerMode } from './protocol';

function hello(
  peerId: string,
  mode: PeerMode = 'owner-device',
): PeerControlMessage {
  return {
    type: 'peer',
    peerId,
    kind: 'hello',
    mode,
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

  it('reports a change when a heartbeat updates the mode', () => {
    const state = new PeerState('peer-local', 'owner-device');
    state.applyMessage(hello('peer-a'), 0);

    const unchanged = state.applyMessage(hello('peer-a'), 1);
    const changed = state.applyMessage(hello('peer-a', 'guest-editor'), 2);

    expect(unchanged).toBe(false);
    expect(changed).toBe(true);
    expect(state.getSnapshot().connectedPeers[0].mode).toBe('guest-editor');
  });
});
