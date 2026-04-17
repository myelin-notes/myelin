# Plan: Remote Repository & Local Cache

## Context

Myelin currently stores notes in app data through `LocalRepository`. This plan adds a configurable remote backend (starting with GitHub) without regressing local performance, offline editing, or crash recovery.

## Design constraints

- GitHub credentials never live in renderer state or `localStorage`.
- Repository selection is owned by app-level context, not a hardcoded singleton.
- The active repository has an explicit lifecycle: initialize, refresh, flush pending work, and dispose.
- The local cache remains the fast path for reads and writes. Remote sync is asynchronous and resumable.
- Existing local-only affordances such as "Reveal in Finder" continue to compile by returning `null` on backends that do not support them.

---

## Phase 1: Repository Abstraction + Lifecycle

**Why**: `export const repository = new LocalRepository()` is a hardcoded singleton. We need a replaceable active repository and a place to own initialization and flush behavior.

### New files

**`src/lib/sync/repo/config.ts`** - Repository configuration types:
```typescript
type RepositoryConfig =
  | { kind: 'local' }
  | {
      kind: 'github';
      owner: string;
      repo: string;
      branch?: string;
      credentialId: string;
    };

interface RepositoryLifecycle {
  initialize(): Promise<void>;
  refresh(): Promise<void>;
  flushPending(): Promise<void>;
  dispose(): Promise<void>;
}

type ActiveRepository = Repository & YjsSyncTarget & RepositoryLifecycle;
```

**`src/lib/sync/repo/factory.ts`** - Creates the active repository:
```typescript
function createRepository(config: RepositoryConfig): ActiveRepository
```

**`src/lib/sync/context.ts`** - React context + provider:
```typescript
interface RepositoryStatus {
  config: RepositoryConfig;
  initializing: boolean;
  online: boolean;
  pendingRemoteWrites: number;
  lastRemoteSyncAt: number | null;
  lastError: Error | null;
}

interface RepositoryContextValue {
  repository: ActiveRepository;
  status: RepositoryStatus;
}

const RepositoryContext = createContext<RepositoryContextValue>(...);

function RepositoryProvider({ children })
function useRepository(): ActiveRepository
function useRepositoryStatus(): RepositoryStatus
```

### Modify

**`src/lib/sync/repo/types.ts`**
- Add `getRevealPath(nodeId: string): Promise<string | null>` to the base `Repository` interface.
- `LocalRepository` keeps its current implementation.
- Remote-backed repositories return `null`.

**`src/lib/sync/index.ts`**
- Remove: `export const repository = new LocalRepository()`
- Add: re-export context/factory hooks and types.

**All repository consumers** - replace `repository` imports with `useRepository()`:
1. `src/pages/free-canvas/hooks/use-canvas-engine.ts`
2. `src/components/layout/sidebar.tsx`
3. `src/pages/library/index.tsx`
4. `src/pages/library/semantic-tags.tsx`
5. `src/pages/library/explorer/explorer-tree.tsx`
6. `src/pages/library/explorer/file-item.tsx`
7. `src/pages/library/explorer/use-explorer-item.ts`
8. `src/pages/library/explorer/use-drop-target.ts`
9. `src/pages/library/tag-manage-dialog.tsx`

**App root**
- Wrap the app in `<RepositoryProvider>`.
- Provider owns repository creation, `initialize()` on mount, and `dispose()` on unmount.
- Provider installs `beforeunload` and Tauri close handlers that call `flushPending()`.

### Verify

- App behavior is unchanged with default `{ kind: 'local' }`.
- Debug "Reveal in Finder" still works locally and safely no-ops on non-local backends.

---

## Phase 2: Secure GitHub Configuration + Settings Integration

**Why**: The app needs a real source of repository configuration, and GitHub credentials must not be exposed to the renderer.

### New Rust module

**`src-tauri/src/github_credentials.rs`**

Owns secure credential access for GitHub tokens.

Suggested commands:
- `github_store_token(credential_id, token) -> ()`
- `github_clear_token(credential_id) -> ()`
- `github_has_token(credential_id) -> bool`

### Storage rules

- Non-secret settings (`kind`, `owner`, `repo`, `branch`, `credentialId`) live in `UserPrefs`.
- The GitHub token is stored only in OS secure storage via Rust.
- If secure storage is unavailable, GitHub auth setup fails closed and the GitHub backend cannot be enabled on that device.

### Modify

**`src/lib/user-prefs.ts`**
- Add repository config preference entries for non-secret settings only.
- Do not add token storage.

**Settings UI**
- Add backend selection (`local` / `github`).
- Add owner/repo/branch inputs.
- Add token connect/disconnect controls that call secure Rust commands.
- Surface `github_has_token()` so the UI can show connected vs missing credentials without reading the token.
- If secure storage is unavailable, show GitHub sync as unavailable instead of degrading to plaintext storage.

### Verify

- User can switch between local and GitHub backends in Settings.
- Restart preserves backend selection and repo coordinates.
- Restart does not require re-entering the token if secure storage still has it.

---

## Phase 3: GitHub Repository Backend (Rust-bridged)

**Why**: Remote persistence should use GitHub without exposing tokens to the webview.

### New frontend file

**`src/lib/sync/repo/github.ts`**

```typescript
class GitHubRepository implements Repository, YjsSyncTarget {
  readonly kind = 'github';
  readonly capabilities = { polling: true, liveSync: false };

  constructor(config: {
    owner: string;
    repo: string;
    branch: string;
    credentialId: string;
  });
}
```

This class is a thin adapter over Rust commands. It does not call `fetch()` directly.

### New Rust file

**`src-tauri/src/github_repo.rs`**

Responsibilities:
- Load the GitHub token from secure storage using `credentialId`
- Make authenticated GitHub API calls with `reqwest`
- Return typed results to the frontend without ever returning the raw token

Suggested command surface:
- `github_get_contents(path) -> { sha: string | null, bytes: number[] | null }`
- `github_put_contents(path, bytes, sha, message) -> { sha: string }`
- `github_delete_contents(path, sha, message) -> ()`

### GitHub repo structure

```
manifest.json
files/
  {uuid}.myelin
```

### Implementation details

- VFS operations mutate `manifest.json`.
- Note data reads/writes `files/*.myelin`.
- Optimistic concurrency uses GitHub blob SHA.
- On SHA mismatch:
  1. refetch remote content
  2. apply the requested mutation against the fresh state
  3. retry
- `openSession()` mirrors `LocalRepository` by loading the note and creating a `NoteSession`.
- `getRevealPath()` returns `null`.

### Modify

**`src-tauri/src/lib.rs`**
- Register the secure credential and GitHub repository commands.

**`src/lib/sync/repo/factory.ts`**
- Add the GitHub case.

### CSP note

No webview CSP change is required if GitHub traffic stays in Rust.

### Verify

- Configure GitHub backend in Settings.
- Create a note and observe `manifest.json` plus `files/{id}.myelin` in the target repo.
- Edit a note and observe the corresponding file update in GitHub.

---

## Phase 4: Cached Repository + Persistent Outbox

**Why**: GitHub is slower and less reliable than the local filesystem. The app needs a cache-backed repository that stays responsive offline and can resume pending work after restart.

### New file

**`src/lib/sync/repo/cached.ts`**

```typescript
type PendingOp =
  | { kind: 'upsert-manifest-node'; nodeId: string }
  | { kind: 'delete-manifest-node'; nodeId: string }
  | { kind: 'push-note'; noteId: string };

class CachedRepository implements Repository, YjsSyncTarget, RepositoryLifecycle {
  constructor(
    private remote: Repository & YjsSyncTarget,
    private cache: LocalRepository,
  );
}
```

### Strategy

- **Reads**: serve from cache immediately.
- **VFS writes**: apply to cache immediately, then enqueue a semantic manifest operation in a persistent outbox.
- **Yjs note writes**: apply to cache immediately, then enqueue a `push-note` operation keyed by note ID. Coalesce repeated pushes for the same note.
- **Outbox persistence**: store pending operations in app data so a force-quit does not lose unsynced work.
- **Replay**: run on `initialize()`, periodic background sync, manual `refresh()`, and `flushPending()`.
- **Refresh behavior**: `refresh()` is an immediate reconciliation action, not a persisted outbox job.
- **Conflict handling**:
  - Manifest conflicts refetch the latest remote manifest and replay pending semantic operations.
  - Note conflicts still use CRDT merge through the existing `pushUpdates()` / `pullUpdates()` flow.

### Behavioral rules

- Offline create/rename/move/tag/delete should continue to work against the cache.
- Remote status is eventual, not blocking, for normal editing.
- `flushPending()` is the "drain the outbox now" entry point used during app close.

### Modify

**`src/lib/sync/repo/factory.ts`**
- GitHub config returns `new CachedRepository(new GitHubRepository(config), new LocalRepository())`.

**`src/lib/sync/repo/local.ts`**
- Keep as the cache implementation and reference VFS/Yjs behavior.

### Verify

- Configure GitHub backend. Create, rename, move, tag, and edit notes while online.
- Disconnect the network. The same actions continue to work locally.
- Reconnect. Pending manifest and note operations replay to GitHub.
- Force-kill the app. Restart. The outbox replays and GitHub catches up.

---

## Phase 5: Session + App Lifecycle Wiring

**Why**: Repository lifecycle and note-session lifecycle have to meet cleanly at route changes and app shutdown.

### Modify

**`src/lib/sync/session.ts`**
- `close()` should push dirty local Yjs state before marking the session closed.
- Keep transport cleanup after push so in-memory peers do not keep sending updates during shutdown.

**`src/pages/free-canvas/hooks/use-canvas-engine.ts`**
- Close the previous `NoteSession` on file changes and unmount, awaiting the close where practical.
- Register a close handler that closes the active session before app shutdown.

**`src/lib/sync/context.ts`**
- Provider calls `flushPending()` during `beforeunload` and Tauri close requests.
- Expose repository status so the UI can surface pending remote writes later if desired.

### Verify

- Navigating away from a canvas flushes the current note session.
- Closing the window flushes both the active note session and the repository outbox.

---

## Key Files Reference

| File | Role |
|------|------|
| `src/lib/sync/repo/types.ts` | Repository + VFS type definitions |
| `src/lib/sync/types.ts` | YjsSyncTarget interface |
| `src/lib/sync/session.ts` | NoteSession - ties sync target + transport |
| `src/lib/sync/repo/local.ts` | LocalRepository - cache and local backend |
| `src/lib/sync/repo/github.ts` | Frontend adapter for GitHub backend |
| `src/lib/sync/repo/cached.ts` | Cache-backed repository with outbox |
| `src/lib/sync/context.ts` | Active repository provider + lifecycle owner |
| `src/lib/user-prefs.ts` | Non-secret repository preferences |
| `src-tauri/src/github_credentials.rs` | Secure credential commands |
| `src-tauri/src/github_repo.rs` | Rust-side GitHub API client |
| `src/pages/free-canvas/hooks/use-canvas-engine.ts` | Session lifecycle wiring |
