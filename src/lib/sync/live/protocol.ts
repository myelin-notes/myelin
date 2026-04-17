const YJS_UPDATE_TAG = 0x01;
const PEER_TAG = 0x02;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type PeerMode = 'owner-device' | 'guest-editor' | 'guest-viewer';
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

function isPeerMode(value: unknown): value is PeerMode {
  return (
    value === 'owner-device' ||
    value === 'guest-editor' ||
    value === 'guest-viewer'
  );
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
    const mode = raw.mode;

    if (!peerId || !isPeerMessageKind(kind) || !isPeerMode(mode)) {
      return null;
    }

    return {
      type: 'peer',
      peerId,
      kind,
      mode,
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
