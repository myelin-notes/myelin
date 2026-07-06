import { describe, expect, it } from 'vitest';
import { PeerState } from './peer-state';
import type { PeerControlMessage } from './protocol';

function hello(
  peerId: string,
  capabilities: string[] = [],
): PeerControlMessage {
  return {
    type: 'peer',
    peerId,
    kind: 'hello',
    mode: 'owner-device',
    capabilities,
  };
}

describe('PeerState capabilities', () => {
  it('stores advertised capabilities in the snapshot', () => {
    const state = new PeerState('peer-local', 'owner-device');

    state.applyMessage(hello('peer-a', ['transcription']), 0);

    expect(state.getSnapshot().connectedPeers).toEqual([
      {
        peerId: 'peer-a',
        mode: 'owner-device',
        capabilities: ['transcription'],
      },
    ]);
  });

  it('reports a change when a heartbeat updates capabilities', () => {
    const state = new PeerState('peer-local', 'owner-device');
    state.applyMessage(hello('peer-a'), 0);

    const unchanged = state.applyMessage(hello('peer-a'), 1);
    const changed = state.applyMessage(hello('peer-a', ['transcription']), 2);

    expect(unchanged).toBe(false);
    expect(changed).toBe(true);
    expect(state.getSnapshot().connectedPeers[0].capabilities).toEqual([
      'transcription',
    ]);
  });
});
