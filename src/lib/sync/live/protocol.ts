import type { PeerMode } from '@myelin/editor/sync/live/peers';

const YJS_UPDATE_TAG = 0x01;
const PEER_TAG = 0x02;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type { PeerMode };
export type PeerMessageKind = 'hello' | 'heartbeat' | 'left';

export interface YjsUpdateMessage {
  type: 'yjs-update';
  data: Uint8Array;
}

export interface PeerControlMessage {
  type: 'peer';
  peerId: string;
  kind: PeerMessageKind;
  mode: PeerMode;
}

export type SyncMessage = YjsUpdateMessage | PeerControlMessage;

function withTag(tag: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(payload.byteLength + 1);
  bytes[0] = tag;
  bytes.set(payload, 1);
  return bytes;
}

function isPeerMessageKind(value: unknown): value is PeerMessageKind {
  return value === 'hello' || value === 'heartbeat' || value === 'left';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodePeerMessage(bytes: Uint8Array): PeerControlMessage | null {
  try {
    const raw = JSON.parse(textDecoder.decode(bytes));
    if (!isRecord(raw)) {
      return null;
    }

    const peerId =
      typeof raw.peerId === 'string' ? raw.peerId.trim() : undefined;
    const kind = raw.kind;

    if (!peerId || !isPeerMessageKind(kind)) {
      return null;
    }

    return {
      type: 'peer',
      peerId,
      kind,
      // Older peers may send a guest mode; every peer is an owner device now.
      mode: 'owner-device',
    };
  } catch {
    return null;
  }
}

export function encodeMessage(message: SyncMessage): Uint8Array {
  if (message.type === 'yjs-update') {
    return withTag(YJS_UPDATE_TAG, message.data);
  }

  return withTag(
    PEER_TAG,
    textEncoder.encode(
      JSON.stringify({
        peerId: message.peerId,
        kind: message.kind,
        mode: message.mode,
        // iroh-gossip drops any message whose bytes it saw in the last 90s, so repeated
        // heartbeats must differ or peers time out while still connected.
        nonce: Math.random(),
      }),
    ),
  );
}

export function decodeMessage(bytes: Uint8Array): SyncMessage | null {
  if (bytes.byteLength < 1) {
    return null;
  }

  const tag = bytes[0];
  const payload = bytes.subarray(1);

  if (tag === YJS_UPDATE_TAG) {
    return {
      type: 'yjs-update',
      data: new Uint8Array(payload),
    };
  }

  if (tag === PEER_TAG) {
    return decodePeerMessage(payload);
  }

  return null;
}
