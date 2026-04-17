# Plan: Multi-Device Live Sync, iroh Transport, Guests

## Context

This plan builds on the remote repository plan. Once notes are stored remotely with a local cache and persistent outbox, this adds live collaboration between devices, writer coordination, and guest sessions over peer-to-peer transport.

**Prerequisite**: `PLAN-remote-repository.md` phases 1-5 completed.

## Design constraints

- `PeerId` is an application-level identity. Transport-level IDs such as TCP addresses and iroh `NodeId`s stay transport-local.
- Membership and liveness come from sync protocol messages, not from transport-specific "peer joined" callbacks.
- Writer election must not depend on wall-clock ordering between machines.
- Transport connection happens before session-level presence announcements.

---

## Phase 1: Sync Protocol Layer (Message Envelope)

**Why**: `NoteSession` currently sends raw Yjs `Uint8Array` over transport. Multi-device coordination needs typed control messages alongside Yjs updates.

### New file: `src/lib/sync/live/protocol.ts`

```typescript
type PeerRole = 'owner' | 'editor' | 'viewer';

type SyncMessage =
  | { type: 'yjs-update'; data: Uint8Array }
  | {
      type: 'presence';
      peerId: string;
      role: PeerRole;
      kind: 'join' | 'heartbeat' | 'left';
    }
  | { type: 'writer-heartbeat'; peerId: string };

function encodeMessage(msg: SyncMessage): Uint8Array
function decodeMessage(bytes: Uint8Array): SyncMessage | null
```

Codec:
- `0x01` + raw bytes for `yjs-update`
- `0x02` + JSON payload for control messages
- Unknown tags or malformed JSON decode to `null` and are ignored

### Modify: `src/lib/sync/session.ts`

- Wrap outgoing document updates in `{ type: 'yjs-update' }`
- Decode incoming bytes before dispatching
- `sendInitialState()` still sends the full diff, but now inside the protocol envelope

### No changes to

- `Transport` interface
- `TcpTransport`

### Verify

- Host/join through the current TCP panel.
- Drawing syncs exactly as before.

---

## Phase 2: Peer Identity + Deterministic Writer Selection

**Why**: Multi-device sync needs stable application identities and a writer-selection rule that does not depend on cross-device clock accuracy.

### New file: `src/lib/sync/identity.ts`

Peer ID management:
```typescript
function getOrCreatePeerId(): string
function createEphemeralPeerId(): string
```

- Owner devices use a persistent UUID stored in `UserPrefs`.
- Guest sessions use an ephemeral UUID.

### New file: `src/lib/sync/live/peer-group.ts`

```typescript
interface PeerInfo {
  peerId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: number;
  lastSeenAt: number;
}

class PeerGroup extends EventTarget {
  readonly localPeerId: string;

  handleMessage(msg: SyncMessage): void;
  announceJoin(transport: Transport): void;
  announceLeave(transport: Transport): void;
  startPresence(transport: Transport): void;
  stopPresence(): void;
  startWriterHeartbeat(transport: Transport): void;
  stopWriterHeartbeat(): void;
  dispose(): void;

  get isWriter(): boolean;
  get currentWriter(): string | null;
  get connectedPeers(): PeerInfo[];
}
```

### Writer selection algorithm

1. On transport `connected`, the local peer sends `{ type: 'presence', kind: 'join', ... }`.
2. Every peer sends a `presence` heartbeat every 5s while connected.
3. A peer is considered connected if it has been seen within the last 15s.
4. Eligible writer set = connected peers with role `owner`.
5. `currentWriter` = lexicographically smallest eligible `peerId`.
6. The elected writer emits `writer-heartbeat` every 5s for UI and diagnostics only. Heartbeats do not break ties.
7. Any membership change or timeout causes all peers to recompute the same result locally.

This removes wall-clock ordering from correctness.

### Modify: `src/lib/sync/session.ts`

- Add `peerGroup: PeerGroup | null`
- Create the `PeerGroup` once per session, not once per transport
- On transport `connected`:
  - call `sendInitialState()`
  - call `peerGroup.announceJoin()`
  - start periodic presence
  - start writer heartbeat if elected
- On transport `disconnected`:
  - stop periodic presence
  - stop writer heartbeat
- Route decoded control messages through `peerGroup.handleMessage()`
- Expose peer-group snapshot for UI

### Modify: `src/lib/user-prefs.ts`

- Add a `peerId` preference entry.

### Verify

- Device A hosts, device B joins, and both see each other in the peer list.
- Disconnect A. After timeout, B becomes writer if it is an eligible owner peer.
- Reconnect A. Both peers converge on the same writer without using timestamps.

---

## Phase 3: iroh Transport

**Why**: TCP is fine for LAN and debugging, but iroh provides internet-wide peer-to-peer transport with NAT traversal.

### Rust side

**Modify: `src-tauri/Cargo.toml`**

- Add `iroh` dependencies pinned to a tested stable release chosen at implementation time.
- Do not hardcode an unchecked "latest stable" version into the plan.

**New file: `src-tauri/src/iroh_transport.rs`**

```rust
struct IrohState {
    endpoint: Arc<Endpoint>,
    gossip: Arc<Gossip>,
    secret_key: SecretKey,
    active_topics: Mutex<HashMap<String, TopicHandle>>,
}
```

Tauri commands:
- `iroh_start() -> { nodeId: String, ticket: String }`
- `iroh_join_topic(topic_id, peer_tickets) -> ()`
- `iroh_leave_topic(topic_id) -> ()`
- `iroh_send(topic_id, data) -> ()`

Events emitted to frontend:
- `iroh-topic-message { topicId, data, senderNodeId }`
- optional transport-debug events keyed by `NodeId`

Transport events should not claim knowledge of application `peerId`.

**Modify: `src-tauri/src/lib.rs`**
- Register module + commands.

### Frontend side

**New file: `src/lib/sync/live/iroh.ts`**

```typescript
class IrohTransport implements Transport {
  constructor(private topicId: string);
  async connect(peerTickets?: string[]): Promise<void>;
  async send(data: Uint8Array): Promise<void>;
  async destroy(): Promise<void>;
}
```

Implementation notes:
- One `IrohTransport` per note session.
- Topic ID is derived from the note ID.
- The concrete UI creates and connects the transport first, then passes it to `session.setTransport()`.
- `IrohTransport` translates Tauri events into the existing `Transport` events and hides `NodeId` details from the application layer.

### Verify

- Two devices on different networks sync the same note via iroh.
- TCP transport still works for LAN/debug.

---

## Phase 4: Multi-Device Session Management

**Why**: Identity, writer selection, session flush, and transport choice have to come together in the actual editing experience.

### Modify: `src/lib/sync/session.ts`

Auto-save controlled by writer role:
```typescript
class NoteSession {
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  private startAutoSave(): void
  private stopAutoSave(): void

  async close(): Promise<void> {
    this.stopAutoSave();
    if (this.hasRemoteChanges()) {
      await this.push();
    }
    this.clearTransport();
    this.closed = true;
    this.status.phase = 'closed';
  }
}
```

Behavior:
- Start auto-save only while `peerGroup.isWriter` is true.
- Auto-save cadence remains every 10s.
- If the active repository is cache-backed, `push()` updates the cache immediately and relies on the repository outbox for eventual remote delivery.
- `close()` always flushes dirty local state before transport teardown.

### Modify: `src/pages/free-canvas/hooks/use-canvas-engine.ts`

- Pass peer-group state to the UI.
- Hook app/window shutdown to close the active session.

### Modify: `src/pages/free-canvas/components/peer-sync-panel.tsx`

- Keep the panel behind a debug or experimental flag until iroh is stable.
- Add transport selection:
  - iroh for normal multi-device use
  - TCP for LAN/debug fallback
- Show connected peers, current writer, and sync status.

### Verify

- Two devices edit the same note and see real-time sync.
- The elected writer auto-saves every 10s.
- When the writer disappears, another eligible peer takes over after timeout.
- Force-close the app. Restart. Cached state is ahead of GitHub and is flushed by the repository outbox from the prerequisite plan.

---

## Phase 5: Guest Sessions

**Why**: Temporary invite links let a guest view or edit a note without adding the note to their own repository.

### New file: `src/lib/sync/guest/invite.ts`

```typescript
type InviteConnection =
  | { kind: 'iroh'; ticket: string }
  | { kind: 'tcp'; addr: string };

interface InviteToken {
  noteId: string;
  topicId: string;
  connection: InviteConnection;
  permission: 'editor' | 'viewer';
  expiresAt: number;
}

function createInviteToken(params: InviteToken): string
function parseInviteToken(token: string): InviteToken | null
```

Using a transport union keeps guest invites compatible with both iroh and the TCP debug path.

### New file: `src/lib/sync/guest/guest-session.ts`

Manages joining a remote note without a local repository entry. The note exists in memory only for the guest.

```typescript
class GuestSession {
  async join(token: InviteToken): Promise<NoteSession>;
}
```

### New file: `src/pages/guest/index.tsx`

Guest join page:
- paste token or open deep link
- render canvas in edit or read-only mode

### Modify: `src/lib/sync/live/peer-group.ts`

- Mark guest viewers and guest editors as non-writer peers.
- Drop `yjs-update` messages from viewer peers.

### Modify: app routing + Tauri deep link config

- Register `myelin://invite/...` handler.

### Invite flow

1. Owner generates invite containing topic ID, connection info, permission, and expiry.
2. Guest opens link or pastes token.
3. Guest app creates an ephemeral `PeerId` and joins the transport/topic.
4. Guest receives live Yjs state and subsequent updates.
5. Editor guests can send updates. Viewer guests cannot.
6. Permission enforcement is cooperative only; it is acceptable for the note-taking threat model but not a security boundary.

### Verify

- Owner generates invite and guest opens it successfully.
- Editor guest can edit and changes appear for the owner.
- Viewer guest UI is read-only and viewer updates are ignored.
- Expired token disconnects the guest.

---

## Phase Dependency Graph

```
Phase 1 (Protocol) -> Phase 2 (Identity/Writer) -> Phase 4 (Session Wiring) -> Phase 5 (Guests)
                   -> Phase 3 (iroh)           /
```

Phases 2 and 3 can proceed in parallel after Phase 1.

## Risks

| Phase | Risk | Mitigation |
|-------|------|------------|
| Phase 3 (iroh) | Large Rust dependency and API churn | Pin a tested release at implementation time and hide transport details behind `IrohTransport` |
| Phase 2 (writer selection) | Membership drift due to missed heartbeats | Use deterministic recompute from the same peer set and explicit timeouts |
| Phase 5 (guests) | Client-side permissions are not a hard security boundary | Keep the scope cooperative and document the limitation clearly |

## Key Files Reference

| File | Role |
|------|------|
| `src/lib/sync/session.ts` | NoteSession - central integration point |
| `src/lib/sync/live/transport.ts` | Transport interface |
| `src/lib/sync/live/tcp.ts` | Current TCP transport |
| `src/lib/sync/live/iroh.ts` | New iroh transport wrapper |
| `src/lib/sync/live/peer-group.ts` | Peer membership + writer selection |
| `src/lib/sync/live/protocol.ts` | Typed message envelope |
| `src/lib/sync/identity.ts` | Persistent and ephemeral peer IDs |
| `src-tauri/src/peer.rs` | Current Rust TCP peer |
| `src-tauri/src/iroh_transport.rs` | New Rust iroh module |
| `src/pages/free-canvas/hooks/use-canvas-engine.ts` | Canvas <-> session wiring |
| `src/pages/free-canvas/components/peer-sync-panel.tsx` | Sync UI |
