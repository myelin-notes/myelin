import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage, type SyncMessage } from './protocol';

function encodePeerJson(payload: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const bytes = new Uint8Array(json.byteLength + 1);
  bytes[0] = 0x02;
  bytes.set(json, 1);
  return bytes;
}

describe('peer presence messages', () => {
  it('round-trips a peer control message through encode/decode', () => {
    const message: SyncMessage = {
      type: 'peer',
      peerId: 'peer-a',
      kind: 'hello',
      mode: 'owner-device',
    };

    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it('ignores unknown fields', () => {
    const decoded = decodeMessage(
      encodePeerJson({
        peerId: 'peer-a',
        kind: 'hello',
        mode: 'owner-device',
        futureField: { nested: true },
      }),
    );

    expect(decoded).toEqual({
      type: 'peer',
      peerId: 'peer-a',
      kind: 'hello',
      mode: 'owner-device',
    });
  });

  it('rejects messages missing required fields', () => {
    expect(
      decodeMessage(encodePeerJson({ peerId: 'peer-a', kind: 'hello' })),
    ).toBeNull();
  });
});
