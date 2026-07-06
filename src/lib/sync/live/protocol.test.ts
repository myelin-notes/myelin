import { describe, expect, it } from 'vitest';
import { decodeMessage, encodeMessage, type SyncMessage } from './protocol';

function encodePeerJson(payload: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const bytes = new Uint8Array(json.byteLength + 1);
  bytes[0] = 0x02;
  bytes.set(json, 1);
  return bytes;
}

describe('peer presence capability advertisement', () => {
  it('round-trips capabilities through encode/decode', () => {
    const message: SyncMessage = {
      type: 'peer',
      peerId: 'peer-a',
      kind: 'hello',
      mode: 'owner-device',
      capabilities: ['transcription'],
    };

    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it('round-trips an empty capability list', () => {
    const message: SyncMessage = {
      type: 'peer',
      peerId: 'peer-a',
      kind: 'heartbeat',
      mode: 'owner-device',
      capabilities: [],
    };

    expect(decodeMessage(encodeMessage(message))).toEqual(message);
  });

  it('treats messages from older clients without capabilities as empty', () => {
    const decoded = decodeMessage(
      encodePeerJson({
        peerId: 'peer-a',
        kind: 'hello',
        mode: 'owner-device',
      }),
    );

    expect(decoded).toEqual({
      type: 'peer',
      peerId: 'peer-a',
      kind: 'hello',
      mode: 'owner-device',
      capabilities: [],
    });
  });

  it('drops malformed capability values', () => {
    const nonArray = decodeMessage(
      encodePeerJson({
        peerId: 'peer-a',
        kind: 'hello',
        mode: 'owner-device',
        capabilities: 'transcription',
      }),
    );
    const mixed = decodeMessage(
      encodePeerJson({
        peerId: 'peer-a',
        kind: 'hello',
        mode: 'owner-device',
        capabilities: ['transcription', 7, null],
      }),
    );

    expect(
      nonArray && nonArray.type === 'peer' && nonArray.capabilities,
    ).toEqual([]);
    expect(mixed && mixed.type === 'peer' && mixed.capabilities).toEqual([
      'transcription',
    ]);
  });

  it('still ignores unknown fields', () => {
    const decoded = decodeMessage(
      encodePeerJson({
        peerId: 'peer-a',
        kind: 'hello',
        mode: 'owner-device',
        capabilities: ['transcription'],
        futureField: { nested: true },
      }),
    );

    expect(decoded).toEqual({
      type: 'peer',
      peerId: 'peer-a',
      kind: 'hello',
      mode: 'owner-device',
      capabilities: ['transcription'],
    });
  });
});
