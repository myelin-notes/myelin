# Plan: Multi-Device Live Sync, iroh Transport, Guests

## Context

Builds on the remote repository plan. Once notes are stored remotely (GitHub) with local cache, this plan adds real-time collaboration between devices, writer coordination, and guest sessions — all P2P via iroh with zero infrastructure cost.

**Prerequisite**: PLAN-remote-repository.md phases 1-3 completed.

---

## Phase 1: Sync Protocol Layer (Message Envelope)

**Why**: NoteSession currently sends raw Yjs `Uint8Array` over transport. Multi-device coordination needs typed messages (writer claims, heartbeats, presence) alongside Yjs updates.

### New file: `src/lib/sync/live/protocol.ts`

```typescript
type SyncMessage =
  | { type: 'yjs-update'; data: Uint8Array }
  | { type: 'writer-claim'; peerId: string; timestamp: number }
  | { type: 'writer-heartbeat'; peerId: string }
  | { type: 'presence'; peerId: string; role: string; status: 'joined' | 'left' }

function encodeMessage(msg: SyncMessage): Uint8Array
function decodeMessage(bytes: Uint8Array): SyncMessage
```

Codec: 1-byte tag prefix + payload. `yjs-update` = tag `0x01` + raw bytes. Control messages = tag `0x02` + JSON via TextEncoder. Unknown message types silently ignored (forward-compatible).

### Modify: `src/lib/sync/session.ts`

- Wrap outgoing updates: `transport.send(encodeMessage({ type: 'yjs-update', data: update }))`
- Decode incoming: `decodeMessage(data)` in `onTransportMessage`, dispatch by `msg.type`
- `sendInitialState()` wraps diff in `yjs-update` envelope

### No changes to: `Transport` interface, `TcpTransport`

### Verify
- Host/join via PeerSyncPanel on LAN. Drawing syncs as before (protocol is transparent).

---

## Phase 2: Peer Identity + Writer Election

**Why**: Multi-device needs to know who's connected, who persists to the remote repo. Transport-agnostic — uses `PeerId`, not iroh NodeId or TCP addresses.

### New file: `src/lib/sync/identity.ts`

PeerId management:
```typescript
function getOrCreatePeerId(): string   // persistent UUID for owner devices (stored in UserPrefs)
function createEphemeralPeerId(): string  // for guests
```

### New file: `src/lib/sync/live/peer-group.ts`

Coordination state machine:

```typescript
interface PeerInfo {
  peerId: string;
  role: 'owner' | 'editor' | 'viewer';
  joinedAt: number;
  lastHeartbeat: number;
}

class PeerGroup extends EventEmitter<{
  'writer-changed': (writerId: string | null) => void;
  'peers-changed': (peers: PeerInfo[]) => void;
}> {
  readonly localPeerId: string;

  handleMessage(msg: SyncMessage): SyncMessage | null;
  announceSelf(transport: Transport): void;
  startHeartbeat(transport: Transport): void;
  stopHeartbeat(): void;
  dispose(): void;

  get isWriter(): boolean;
  get currentWriter(): string | null;
  get connectedPeers(): PeerInfo[];
}
```

**Writer election algorithm** (deterministic, no central authority):
1. On join, peer sends `{ type: 'presence', peerId, role, status: 'joined' }`.
2. If no writer exists (or previous writer timed out), eligible peers send `{ type: 'writer-claim', peerId, timestamp }`.
3. Lowest `(timestamp, peerId)` tuple wins. All peers converge deterministically.
4. Writer sends `{ type: 'writer-heartbeat', peerId }` every 5s.
5. No heartbeat for 15s → peers consider writer gone, re-elect.

**Writer role governs periodic auto-save only.** Any device flushes to repo on exit if it has unpushed local changes, regardless of writer role.

### Modify: `src/lib/sync/session.ts`

- Add `peerGroup: PeerGroup | null` field
- `setTransport()` creates PeerGroup, calls `announceSelf()`
- `onTransportMessage` routes through `peerGroup.handleMessage()` first
- Expose peerGroup state for UI

### Modify: `src/lib/user-prefs.ts`

Add `peerId` pref entry.

### Verify
- Host on device A, join from B. Both see each other.
- Kill A's connection. B claims writer after 15s timeout.
- Reconnect A. Sees B as writer, does not contest.

---

## Phase 3: iroh Transport

**Why**: TCP is LAN-only. iroh provides NAT traversal + QUIC for internet-wide P2P at zero infrastructure cost. Free public relay nodes for fallback.

### Rust side

**Modify: `src-tauri/Cargo.toml`**
```toml
iroh = "0.32"        # pin to latest stable
iroh-gossip = "0.32"
iroh-base = "0.32"
```

**New file: `src-tauri/src/iroh_transport.rs`**

```rust
struct IrohState {
    endpoint: Arc<Endpoint>,
    gossip: Arc<Gossip>,
    secret_key: SecretKey,       // persisted in app data for stable NodeId
    active_topics: Mutex<HashMap<String, TopicHandle>>,
}
```

Tauri commands:
- `iroh_start() -> String` — boot endpoint, return NodeId
- `iroh_join_topic(topic_id, peer_node_addrs) -> ()` — subscribe to gossip topic
- `iroh_leave_topic(topic_id) -> ()` — unsubscribe
- `iroh_send(topic_id, data) -> ()` — broadcast to topic
- `iroh_get_ticket() -> String` — serialized NodeAddr for sharing

Events emitted to frontend:
- `iroh-topic-message { topicId, data, senderId }`
- `iroh-peer-joined { topicId, peerId }`
- `iroh-peer-left { topicId, peerId }`

**Modify: `src-tauri/src/lib.rs`** — register module + commands.

### Frontend side

**New file: `src/lib/sync/live/iroh.ts`**

```typescript
class IrohTransport implements Transport {
  constructor(private topicId: string);
  async connect(peerAddrs?: string[]): Promise<void>;
  async send(data: Uint8Array): Promise<void>;
  async destroy(): Promise<void>;
}
```

One IrohTransport per note session (topic-scoped). Each note being edited = one gossip topic (derived from `hash(noteId)`). Multiple peers subscribe to same topic.

### PeerId ↔ NodeId separation

- iroh events include sender's NodeId — this stays inside IrohTransport
- Application layer only sees PeerId (from `presence` messages in the protocol layer)
- IrohTransport can maintain a NodeId→PeerId lookup internally for debugging
- PeerGroup never touches NodeId

### Verify
- Two devices on different networks sync a note via iroh.
- TCP transport still works for LAN/debug.

---

## Phase 4: Multi-Device Session Management

**Why**: Wire identity, writer election, auto-save, and flush-on-exit into the cohesive experience.

### Modify: `src/lib/sync/session.ts`

Auto-save controlled by writer role:
```typescript
class NoteSession {
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  // PeerGroup emits 'writer-changed' → start/stop auto-save
  private startAutoSave(): void    // setInterval, push() every 10s
  private stopAutoSave(): void     // clearInterval

  // close() always flushes if dirty, regardless of writer role
  async close(): Promise<void> {
    this.stopAutoSave();
    const localSV = this.ydoc.encodeStateVector();
    if (!bytesEqual(localSV, this.remoteStateVector)) {
      await this.push();
    }
    this.clearTransport();
    this.closed = true;
    this.status.phase = 'closed';
  }
}
```

### Modify: `src/pages/free-canvas/hooks/use-canvas-engine.ts`

- Add `beforeunload` / Tauri `close-requested` flush (if not already done in repo plan)
- Pass PeerGroup state to UI for sync status display

### Modify: `src/pages/free-canvas/components/peer-sync-panel.tsx`

- Remove DEBUG gate — production UI
- Show connected peers, current writer, sync status
- Support iroh (production) and TCP (debug) transport selection

### Verify
- Two devices edit same note. Real-time sync via iroh.
- Writer auto-saves to GitHub every 10s.
- Kill writer. Other device becomes writer after 15s, starts auto-saving.
- Force-close app. Restart. Local cache ahead of GitHub. Pushes diff on next open.

---

## Phase 5: Guest Sessions

**Why**: Temporary invite links for guests to view/edit a note without a Myelin account.

### New file: `src/lib/sync/guest/invite.ts`

```typescript
interface InviteToken {
  noteId: string;
  topicId: string;
  hostAddr: string;           // transport-specific connection info
  permission: 'editor' | 'viewer';
  expiresAt: number;
}

function createInviteToken(params: InviteToken): string     // base64url encode
function parseInviteToken(token: string): InviteToken | null
```

### New file: `src/lib/sync/guest/guest-session.ts`

Manages joining a remote note without a local repository entry. Ephemeral Y.Doc in memory only.

```typescript
class GuestSession {
  async join(token: InviteToken): Promise<NoteSession>;
  // Creates transport, connects to topic, receives initial state
}
```

### New file: `src/pages/guest/index.tsx`

Guest join page — paste token or arrive via deep link. Renders canvas in read-only or edit mode based on permissions.

### Modify: `src/lib/sync/live/peer-group.ts`

- Track peer permissions (from `presence` message `role` field)
- Drop `yjs-update` messages from view-only peers (cooperative enforcement)

### Modify: app routing + Tauri deep link config

Register `myelin://invite/...` handler.

### Invite flow

1. Owner generates invite → contains topicId + host connection info + permission + expiry
2. Guest opens link / pastes token
3. Guest app creates ephemeral PeerId, connects via transport to topic
4. Guest receives Y.Doc state via protocol
5. Editor guests can send updates. Viewer guests receive only.
6. Permission enforcement is client-side (cooperative, acceptable for note-taking threat model)

### Verify
- Owner generates invite link. Guest opens it. Guest sees the note.
- Editor guest draws. Changes appear on owner's canvas.
- Viewer guest cannot edit (UI locked). Updates from viewer are dropped by PeerGroup.
- Token expires. Guest is disconnected.

---

## Phase Dependency Graph

```
Phase 1 (Protocol) → Phase 2 (Identity/Election) → Phase 4 (Multi-device session)
                   → Phase 3 (iroh)              ↗                                 → Phase 5 (Guests)
```

Phases 2 and 3 can be parallelized after Phase 1.

## Risks

| Phase | Risk | Mitigation |
|-------|------|------------|
| Phase 3 (iroh) | Large Rust dependency, API instability, build time increase | Pin version, cargo feature flag |
| Phase 2 (election) | Clock skew in distributed election | Monotonic timestamps, PeerId tiebreaker |
| Phase 5 (guests) | Client-side permission enforcement only | Acceptable for note-taking threat model |

## Key Files Reference

| File | Role |
|------|------|
| `src/lib/sync/session.ts` | NoteSession — central integration point |
| `src/lib/sync/live/transport.ts` | Transport interface (unchanged) |
| `src/lib/sync/live/tcp.ts` | Current TCP transport (stays as debug fallback) |
| `src-tauri/src/peer.rs` | Current Rust TCP peer (template for iroh module) |
| `src-tauri/Cargo.toml` | Rust dependencies |
| `src/pages/free-canvas/hooks/use-canvas-engine.ts` | Canvas ↔ session wiring |
| `src/pages/free-canvas/components/peer-sync-panel.tsx` | Sync UI |
