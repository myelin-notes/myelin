# Plan: Remote Repository & Local Cache

## Context

Myelin stores notes locally (`~/.config/myelin/`). This plan adds remote persistence (starting with GitHub) with a local cache layer, so notes are backed up and accessible from multiple devices.

---

## Phase 1: Repository Abstraction (Factory + Context)

**Why**: `export const repository = new LocalRepository()` is a hardcoded singleton. Need configurable backends before adding GitHub.

### New files

**`src/lib/sync/repo/config.ts`** — Repository configuration types:
```typescript
type RepositoryConfig =
  | { kind: 'local' }
  | { kind: 'github'; owner: string; repo: string; token: string; branch?: string }
```

**`src/lib/sync/repo/factory.ts`** — Creates repository from config:
```typescript
function createRepository(config: RepositoryConfig): Repository & YjsSyncTarget
```

**`src/lib/sync/context.ts`** — React context + provider:
```typescript
const RepositoryContext = createContext<Repository & YjsSyncTarget>(...)
function RepositoryProvider({ config, children })
function useRepository(): Repository & YjsSyncTarget
```

### Modify

**`src/lib/sync/index.ts`**
- Remove: `export const repository = new LocalRepository()`
- Add: re-export context/factory

**All repository consumers** — replace `repository` import with `useRepository()` hook:
1. `src/pages/free-canvas/hooks/use-canvas-engine.ts`
2. `src/components/layout/sidebar.tsx`
3. `src/pages/library/index.tsx`
4. `src/pages/library/semantic-tags.tsx`
5. `src/pages/library/explorer/explorer-tree.tsx`
6. `src/pages/library/explorer/file-item.tsx`
7. `src/pages/library/explorer/use-explorer-item.ts`
8. `src/pages/library/explorer/use-drop-target.ts`
9. `src/pages/library/tag-manage-dialog.tsx`

**App root** — wrap in `<RepositoryProvider>`.

### Verify
- App behaves identically with default `{ kind: 'local' }` config.

---

## Phase 2: GitHub Repository Backend

**Why**: Remote persistence. Notes stored in a user-owned GitHub repo.

### New file: `src/lib/sync/repo/github.ts`

```typescript
class GitHubRepository implements Repository, YjsSyncTarget {
  readonly kind = 'github';
  readonly capabilities = { polling: true, liveSync: false };

  constructor(config: { owner: string; repo: string; token: string; branch: string });
}
```

**GitHub repo structure:**
```
manifest.json
files/
  {uuid}.myelin
```

**Implementation details:**
- VFS operations → read/write `manifest.json` via GitHub Contents API
- Note data → read/write `files/*.myelin` via Contents API (base64 encoded)
- Optimistic concurrency via SHA (Contents API requires blob SHA for updates)
- `pushUpdates()`: fetch current SHA → load into temp Y.Doc → apply update → encode → PUT with SHA → retry on 409
- `openSession()`: same pattern as LocalRepository — load doc, create NoteSession with `this` as sync target

**GitHub API surface used:**
- `GET /repos/:owner/:repo/contents/:path` — read file
- `PUT /repos/:owner/:repo/contents/:path` — create/update file (with SHA)
- `DELETE /repos/:owner/:repo/contents/:path` — delete file (with SHA)
- Auth: `Authorization: Bearer {token}` header
- All via `fetch()` from the webview

### Modify

**`src-tauri/tauri.conf.json`** — CSP: allow `https://api.github.com` in connect-src.

**`src/lib/sync/repo/factory.ts`** — Add github case.

### Verify
- Configure GitHub PAT + repo. Create a note. See `manifest.json` and `files/{id}.myelin` in GitHub.
- Edit and save. File updated in GitHub.

---

## Phase 3: Local Cache Layer

**Why**: GitHub API is slow and has rate limits. Local cache provides fast reads, offline resilience, and crash recovery.

### New file: `src/lib/sync/repo/cached.ts`

```typescript
class CachedRepository implements Repository, YjsSyncTarget {
  constructor(
    private remote: Repository & YjsSyncTarget,
    private cache: LocalRepository,
  );
}
```

**Strategy:**
- **Reads**: serve from cache. Background-sync from remote periodically or on explicit refresh.
- **Writes (VFS ops)**: write to remote first, then update cache. If remote fails, operation fails (don't silently diverge).
- **YjsSyncTarget**:
  - `loadDocument()`: load from cache. Pull from remote, merge via CRDT, update cache.
  - `pushUpdates()`: push to cache immediately (fast). Push to remote (may be slower). If remote push fails, cache is still up-to-date — retry remote later.
  - `pullUpdates()`: pull from remote, merge into cache, return merged result.
- **On app launch**: pull manifest from remote, reconcile with local cache (remote wins for metadata, CRDT merge for note content).
- **Flush on close**: if cache has unpushed changes, push to remote before exit.

### Modify

**`src/lib/sync/repo/factory.ts`** — GitHub config returns `new CachedRepository(new GitHubRepository(config), new LocalRepository())`.

**`src/pages/free-canvas/hooks/use-canvas-engine.ts`** — Add `beforeunload` / Tauri `close-requested` listener to ensure session flush on unexpected close.

### Verify
- Configure GitHub backend. Create and edit notes. Works as before but backed by GitHub.
- Disconnect network. App continues working from cache.
- Reconnect. Changes sync to GitHub.
- Force-kill app. Restart. Local cache has latest state. Pushes diff to GitHub on next session open.

---

## Key Files Reference

| File | Role |
|------|------|
| `src/lib/sync/repo/types.ts` | Repository + VFS type definitions |
| `src/lib/sync/types.ts` | YjsSyncTarget interface |
| `src/lib/sync/session.ts` | NoteSession — ties sync target + transport |
| `src/lib/sync/repo/local.ts` | LocalRepository (reference implementation) |
| `src/lib/sync/index.ts` | Current singleton export → becomes re-exports |
| `src/lib/user-prefs.ts` | User preferences (localStorage) |
| `src/pages/free-canvas/hooks/use-canvas-engine.ts` | Wires session + canvas + auto-save |
