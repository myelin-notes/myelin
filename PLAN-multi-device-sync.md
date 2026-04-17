# Plan: Multi-Device Live Sync, iroh Transport, Guests

## Context

This plan builds on the remote repository plan. Once notes are stored remotely with a local cache and persistent outbox, this adds live collaboration between devices, writer coordination, and guest sessions over peer-to-peer transport.

**Prerequisite**: `PLAN-remote-repository.md` phases 1-5 completed.

## Design Constraints

- `peerId` is an application-level identity. Transport-level IDs such as TCP addresses and iroh `NodeId`s stay transport-local.
- Membership and liveness come from sync protocol messages, not from transport-specific "peer joined" callbacks.
- Writer election must not depend on wall-clock ordering between machines.
- `NoteSession` remains the lifecycle owner for a note session: transport attachment, timers, and session shutdown.
- Peer membership and writer-election rules should live in a pure helper module, not in a second stateful service and not inline all through `NoteSession`.
- `Transport` remains a byte pipe. Typed sync behavior lives above it.
- Topic identity is derived from the note ID. Do not serialize both `noteId` and a redundant `topicId` in app-level payloads.
- Auto-save and thumbnail generation stay in `use-canvas-engine`, which already owns that cadence.
- Guest note sessions should reuse `NoteSession` through the existing `YjsSyncTarget` interface, not through a parallel guest-only session abstraction.

## Simplifications To Keep

- Use one control-message family for peer presence. Do not add a separate `writer-heartbeat` message because writer state is derived from membership.
- Do not introduce a `peer-group.ts` lifecycle class up front. Keep lifecycle in `NoteSession`, and extract peer-state transitions into a pure helper module.
- Do not introduce a `GuestSession` class. Guest editing should reuse `NoteSession` with an ephemeral sync target.
- Do not build a generic transport-selection framework. The existing debug panel can expose TCP and iroh directly.
- Prefer explicit peer modes over raw booleans in application code so invalid combinations are unrepresentable.

---

## Phase 1: Sync Protocol Layer

**Why**: `NoteSession` currently sends raw Yjs `Uint8Array` over transport. Multi-device coordination needs typed control messages alongside Yjs updates, but the protocol should stay minimal.

### New file: `src/lib/sync/live/protocol.ts`

```typescript
type PeerMode = 'owner-device' | 'guest-editor' | 'guest-viewer';

type SyncMessage =
  | { type: 'yjs-update'; data: Uint8Array }
  | {
      type: 'peer';
      peerId: string;
      kind: 'hello' | 'heartbeat' | 'left';
      mode: PeerMode;
    };

function encodeMessage(msg: SyncMessage): Uint8Array
function decodeMessage(bytes: Uint8Array): SyncMessage | null
```

Notes:

- `PeerMode` encodes the valid combinations the app actually supports:
  - `owner-device`: can edit and is writer-eligible
  - `guest-editor`: can edit and is not writer-eligible
  - `guest-viewer`: read-only and not writer-eligible
- This keeps the protocol explicit without reintroducing a broad overloaded role model.

Codec:

- `0x01` + raw bytes for `yjs-update`
- `0x02` + JSON payload for peer control messages
- Unknown tags or malformed JSON decode to `null` and are ignored

### Modify: `src/lib/sync/session.ts`

- Wrap outgoing document updates in `{ type: 'yjs-update' }`
- Decode incoming bytes before dispatching
- `sendInitialState()` still sends the full diff, but now inside the protocol envelope
- Ignore malformed control messages instead of breaking the session

### No changes to permission handling yet

- Guest viewer enforcement is primarily UI-level read-only mode.
- Dropping updates from viewer peers can be added later as defense in depth, but it should not be treated as a security boundary or as a prerequisite for the protocol layer.

### No changes to

- `Transport` interface
- `TcpTransport`

### Verify

- Host/join through the current TCP panel.
- Drawing syncs exactly as before.
- Malformed control messages are ignored instead of breaking the session.

---

## Phase 2: Peer Identity + Deterministic Writer Selection

**Why**: Multi-device sync needs stable application identities and a writer-selection rule that does not depend on cross-device clock accuracy. `NoteSession` should own lifecycle, while peer-state transitions stay pure and testable.

### New file: `src/lib/sync/identity.ts`

```typescript
function getOrCreatePeerId(): string
function createEphemeralPeerId(): string
```

- Owned devices use a persistent UUID stored in `UserPrefs`.
- Guest sessions use an ephemeral UUID.

### New file: `src/lib/sync/live/peer-state.ts`

Pure peer-state helpers:

```typescript
type PeerMode = 'owner-device' | 'guest-editor' | 'guest-viewer';

interface ConnectedPeer {
  peerId: string;
  mode: PeerMode;
  lastSeenAt: number;
}

interface PeerSnapshot {
  localPeerId: string;
  localMode: PeerMode;
  connectedPeers: Array<{
    peerId: string;
    mode: PeerMode;
  }>;
  currentWriter: string | null;
  isWriter: boolean;
}

interface PeerState;

function createPeerState(localPeerId: string, localMode: PeerMode): PeerState
function applyPeerMessage(state: PeerState, msg: SyncMessage, now: number): boolean
function removePeer(state: PeerState, peerId: string): boolean
function pruneStalePeers(state: PeerState, now: number, timeoutMs: number): boolean
function resetRemotePeers(state: PeerState): boolean
function getPeerSnapshot(state: PeerState): PeerSnapshot
```

Rules:

- `peer-state.ts` owns membership transitions and writer derivation.
- `NoteSession` owns heartbeat timers, transport callbacks, and subscriptions.
- Keep this module free of transport concerns, timers, React, and Yjs side effects so it can be unit-tested in isolation.

### Modify: `src/lib/sync/session.ts`

Add peer lifecycle to `NoteSession`, but delegate state transitions to `peer-state.ts`:

```typescript
interface NoteSessionOptions {
  localPeer?: {
    peerId: string;
    mode: PeerMode;
  };
}

class NoteSession {
  static open(
    nodeId: string,
    syncTarget: YjsSyncTarget,
    options?: NoteSessionOptions,
  ): Promise<NoteSession>;
}
```

Behavior:

1. On transport `connected`, the local peer sends `{ type: 'peer', kind: 'hello', ... }`.
2. Every peer sends a `heartbeat` every 5 seconds while connected.
3. A peer is considered connected if it has been seen within the last 15 seconds.
4. Eligible writer set = connected peers whose `mode` is `owner-device`.
5. `currentWriter` = lexicographically smallest eligible `peerId`.
6. Any membership change or timeout causes `peer-state.ts` to recompute the result locally.

Implementation notes:

- Default `localPeer` to `{ peerId: getOrCreatePeerId(), mode: 'owner-device' }`.
- Guest sessions can pass an explicit ephemeral `localPeer` later without forking `NoteSession`.
- Expose a small subscription surface from `NoteSession` for the UI:

```typescript
subscribePeerSnapshot(listener: (snapshot: PeerSnapshot) => void): () => void
getPeerSnapshot(): PeerSnapshot
```

- On transport `connected`:
  - call `sendInitialState()`
  - announce local peer presence
  - start the periodic heartbeat timer
- On transport `disconnected`:
  - stop the heartbeat timer
  - reset remote peer membership
- On `{ type: 'peer', kind: 'left' }`:
  - remove that peer immediately through `peer-state.ts`
- On timeout:
  - prune stale peers through `peer-state.ts`

### Modify: `src/lib/user-prefs.ts`

- Add a `peerId` preference entry.

### Verify

- Device A hosts, device B joins, and both see each other in the peer list.
- Disconnect A. After timeout, B becomes writer if it is eligible.
- Reconnect A. Both peers converge on the same writer without using timestamps for tie-breaking.

---

## Phase 3: iroh Transport

**Why**: TCP is fine for LAN and debugging, but iroh provides internet-wide peer-to-peer transport with NAT traversal.

### Rust side

**Modify: `src-tauri/Cargo.toml`**

- Add `iroh` dependencies pinned to a tested stable release chosen at implementation time.
- Do not hardcode an unchecked "latest stable" version into the plan.

**New file: `src-tauri/src/iroh_transport.rs`**

Keep Rust-side lifecycle narrow:

- own one process-level endpoint
- own per-topic handles internally
- keep `NodeId` and transport bookkeeping in Rust unless debugging proves the frontend really needs them

Tauri commands should stay minimal. Prefer a surface shaped like:

- open or host a note topic and return a share token
- join a note topic from a share token
- leave a note topic
- send bytes to a note topic

Avoid exposing redundant combinations such as `nodeId + ticket + topicId` if a single opaque share token can carry the same information.

Events emitted to frontend:

- `iroh-topic-message { noteId, data }`
- optional transport-debug events only if the debug UI actually needs them

**Modify: `src-tauri/src/lib.rs`**

- Register module + commands.

### Frontend side

**New file: `src/lib/sync/live/iroh.ts`**

```typescript
class IrohTransport implements Transport {
  constructor(private noteId: string);
  async host(): Promise<{ shareToken: string }>;
  async join(shareToken: string): Promise<void>;
  async send(data: Uint8Array): Promise<void>;
  async destroy(): Promise<void>;
}
```

Implementation notes:

- One `IrohTransport` per note session.
- Topic identity is derived from `noteId`.
- `IrohTransport` translates Tauri events into the existing `Transport` events and hides transport internals from the application layer.

### Verify

- Two devices on different networks sync the same note via iroh.
- TCP transport still works for LAN/debug.
- Writer selection behaves the same on TCP and iroh because it lives above transport.

---

## Phase 4: Multi-Device Session Management

**Why**: Identity, writer selection, session flush, and transport choice have to come together in the actual editing experience, but the save cadence should stay where it already belongs.

### Modify: `src/lib/sync/session.ts`

```typescript
class NoteSession {
  async close(): Promise<void> {
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

- `close()` always flushes dirty local state before transport teardown.
- `NoteSession` exposes `isWriter` via the peer snapshot, but it does not own an auto-save timer.

### Modify: `src/pages/free-canvas/hooks/use-canvas-engine.ts`

- Keep periodic save logic in the hook, alongside thumbnail generation.
- Start auto-save only while `session.getPeerSnapshot().isWriter` is true.
- Auto-save cadence remains every 10 seconds.
- If the active repository is cache-backed, `push()` updates the cache immediately and relies on the repository outbox for eventual remote delivery.
- Hook app/window shutdown to close the active session. The existing repository shutdown wiring already supports this path.
- Keep repository-dependent behavior here:
  - note metadata lookup
  - thumbnail generation
  - repository-backed save cadence
- Do not force guest pages through this hook unchanged; split out shared canvas/session primitives if guest mode needs most of the same UI.

### Modify: `src/pages/free-canvas/components/peer-sync-panel.tsx`

- Keep the panel behind a debug or experimental flag until iroh is stable.
- Extend the existing panel directly rather than building a generic transport picker.
- Add explicit actions for:
  - TCP host / join for LAN and debugging
  - iroh host / join for internet-wide sync
- Show connected peers, current writer, and sync status.

### Verify

- Two devices edit the same note and see real-time sync.
- The elected writer auto-saves every 10 seconds.
- When the writer disappears, another eligible peer takes over after timeout.
- Force-close the app. Restart. Cached state is ahead of GitHub and is flushed by the repository outbox from the prerequisite plan.

---

## Phase 5: Guest Sessions

**Why**: Temporary invite links let a guest view or edit a note without adding the note to their own repository. Guests should reuse `NoteSession`, but they should do so through an explicit ephemeral sync target rather than a guest-only session type.

### New file: `src/lib/sync/guest/invite.ts`

```typescript
type InviteConnection =
  | { kind: 'iroh'; shareToken: string }
  | { kind: 'tcp'; addr: string };

interface InviteToken {
  noteId: string;
  connection: InviteConnection;
  permission: 'editor' | 'viewer';
  expiresAt: number;
}

function createInviteToken(params: InviteToken): string
function parseInviteToken(token: string): InviteToken | null
```

Notes:

- Do not include `topicId` separately. It is derived from `noteId` or already embedded in the transport token.
- Using a transport union keeps guest invites compatible with both iroh and the TCP debug path.

### New file: `src/lib/sync/guest/ephemeral-sync-target.ts`

```typescript
class EphemeralSyncTarget implements YjsSyncTarget {
  loadDocument(nodeId: string): Promise<YjsSyncSnapshot>;
  pullUpdates(nodeId: string, stateVector?: Uint8Array | null): Promise<YjsSyncSnapshot>;
  pushUpdates(
    nodeId: string,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult>;
}
```

Behavior:

- Starts from an empty in-memory document snapshot.
- Accepts `push()` calls so guest pages can reuse standard session flows without writing to the repository.
- Never persists note data to the guest device's repository.

### Modify: `src/lib/sync/session.ts`

Reuse `NoteSession.open(...)` with explicit local peer options instead of adding a `GuestSession` class:

```typescript
const session = await NoteSession.open(
  noteId,
  new EphemeralSyncTarget(),
  {
    localPeer: {
      peerId: createEphemeralPeerId(),
      mode: permission === 'viewer' ? 'guest-viewer' : 'guest-editor',
    },
  },
);
```

Implementation notes:

- Guests reuse the same transport, protocol, and peer-state logic as owned devices.
- Guest viewers are read-only in the UI.
- Guest editors and viewers are both non-writer peers because their `mode` is never `owner-device`.

### New file: `src/pages/guest/index.tsx`

Guest join page:

- paste token or open deep link
- create an ephemeral `NoteSession` via `EphemeralSyncTarget`
- connect the requested transport
- render canvas in edit or read-only mode
- use a guest-specific page or hook that skips repository lookups and local thumbnail persistence

### Modify: app routing + Tauri deep link config

- Register `myelin://invite/...` handler.

### Invite flow

1. Owner generates invite containing note ID, connection info, permission, and expiry.
2. Guest opens link or pastes token.
3. Guest app creates an ephemeral `peerId` and opens a standard `NoteSession` against `EphemeralSyncTarget`.
4. Guest receives live Yjs state and subsequent updates.
5. Editor guests can send updates. Viewer guests cannot.
6. Viewer mode is enforced by the guest UI; protocol-level permissions remain cooperative only.
7. Permission enforcement is not a hard security boundary and should be documented that way.

### Verify

- Owner generates invite and guest opens it successfully.
- Editor guest can edit and changes appear for the owner.
- Viewer guest UI is read-only and viewer updates are ignored.
- Expired token disconnects the guest.

---

## Phase Dependency Graph

```text
Phase 1 (Protocol)
  -> Phase 2 (Identity + Writer Selection)
  -> Phase 4 (Session Wiring)
  -> Phase 5 (Guests)

Phase 1
  -> Phase 3 (iroh)
```

Phases 3 and 4 can proceed in parallel after Phases 1 and 2 are stable enough to exercise over TCP.

## Risks

| Phase | Risk | Mitigation |
|-------|------|------------|
| Phase 3 (iroh) | Large Rust dependency and API churn | Pin a tested release at implementation time and keep iroh details behind `IrohTransport` |
| Phase 2 (writer selection) | Membership drift due to missed heartbeats | Use deterministic recompute from the same peer set and explicit timeouts |
| Phase 5 (guests) | Client-side permissions are not a hard security boundary | Keep the scope cooperative and document the limitation clearly |

## Key Files Reference

| File | Role |
|------|------|
| `src/lib/sync/session.ts` | NoteSession - central integration point |
| `src/lib/sync/live/transport.ts` | Transport interface |
| `src/lib/sync/live/tcp.ts` | Current TCP transport |
| `src/lib/sync/live/iroh.ts` | New iroh transport wrapper |
| `src/lib/sync/live/protocol.ts` | Typed message envelope |
| `src/lib/sync/live/peer-state.ts` | Pure peer membership + writer-election helpers |
| `src/lib/sync/identity.ts` | Persistent and ephemeral peer IDs |
| `src/lib/sync/guest/ephemeral-sync-target.ts` | In-memory sync target for guest sessions |
| `src-tauri/src/peer.rs` | Current Rust TCP peer |
| `src-tauri/src/iroh_transport.rs` | New Rust iroh module |
| `src/pages/free-canvas/hooks/use-canvas-engine.ts` | Canvas <-> session wiring |
| `src/pages/free-canvas/components/peer-sync-panel.tsx` | Sync UI |
| `src/pages/guest/index.tsx` | Guest join flow |
