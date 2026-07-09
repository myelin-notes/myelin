# Editor / Platform Decoupling Refactor Plan

Goal: decouple the core canvas editor from Tauri behind a typed `Platform`
interface with optional capabilities, extract it into `packages/editor`, and
make sync capability-aware so incapable clients (web) never block enrichment
work (transcription) for capable peers.

Out of scope: any changes to `packages/website` / the `web-redesign` branch.
The website is a design constraint only — the extracted package must be
consumable by it (in-memory Y.Doc, no Tauri, all optional capabilities
absent), but porting it happens separately.

Also deferred: web guest client (`guest-editor` PeerMode exists in the
protocol, unused), web Repository/credentials story, plugin registry.
Capability contracts stay registration-shaped so a plugin system can slot in
later; no loader/manifest/sandbox machinery until a real plugin exists. iOS
constraint (no downloaded code) means plugins there are bundled-only — another
reason the registry can wait.

## Current-state facts the plan relies on

- Editor core internals (`drawable-canvas.ts`, `ydoc-manager.ts`, element
  store, geometry, tools, clipboard, media import) have zero direct Tauri
  imports; the 7 inline call sites below (which include two element classes
  and three PM-stack files) are the complete direct-import surface under
  `src/pages/canvas`. Transitive Tauri also leaks in through the
  `@/lib/sync` barrel and `use-thumbnail-url` (see Phase 1). Doc model is
  Yjs; `.mcanvas` = binary Yjs update. Audio/PDF bytes live inside the
  Y.Doc, so persistence is entirely the repository's concern.
- Persistence is already abstracted: `Repository` interface
  (`src/lib/sync/repo/types.ts`) via React context; Tauri only in
  implementations. Live sync already has a `Transport` interface +
  `noopTransport` (`src/lib/sync/live/transport.ts`).
- Direct Tauri usage reachable from canvas is 7 inline call sites plus thin
  per-domain service modules in `src/lib` (transcription, handwriting,
  code-runner, pdf-export, note-index, thumbnails, iroh).
- Ownership today: audio transcription is the only enrichment job that writes
  into the synced doc. It is gated by a static `creatorPeerId` set at element
  creation; non-creators show an indefinite "Transcribing…" spinner. If the
  creator device never transcribes, the element is dead-ended forever.
  Handwriting/OCR, note index, and thumbnails are local cache artifacts —
  redundant per client, hash-keyed, no cross-client coordination needed.
- No `isTauri` check exists anywhere; the app assumes Tauri unconditionally.

## Phase 1 — Platform + capability layer, in place (no file moves)

Semantic change first, mechanical move second, so each is reviewable.

1. `src/platform/types.ts`: the `Platform` interface.
   - Required primitives: `saveFile({ suggestedName, data })` (dialog+write on
     desktop, download on web), `openExternal(url)`, `fetch` (plugin-http on
     desktop, `window.fetch` on web), artifact cache (fs AppCache on desktop,
     OPFS/IndexedDB later on web), log sink, event subscribe.
   - Optional capabilities — absence IS the signal: `transcription`,
     `handwriting`, `codeRunner`, `pdfExport`, `noteIndex`,
     `createLiveTransport`.
   - Capability interfaces are high-level feature contracts (e.g.
     `pdfExport.export(request)` owns destination picking), not Tauri-API
     emulation. Lift shapes from the existing service modules —
     `AudioTranscriptionSession` and `Transport` already exist as interfaces.
2. `src/platform/tauri/`: implementations — mostly relocating the
   invoke/listen halves of today's `service.ts` / `client.ts` / `cache.ts`
   files. `setPlatform(tauriPlatform)` in bootstrap before render. Module
   singleton, not React context: element classes and PM plugins consume
   services outside React.
3. Sweep the inline canvas call sites:
   - save dialogs: `canvas-pdf-export.ts`, `elements/pdf-element.ts`,
     `elements/page-frame-element.ts` (+ its `writeTextFile`)
   - `plugin-http` fetch: `page-frame/pm/embed/fetcher.ts`
   - `openUrl`: `page-frame/pm/markdown/links.ts`
   - raw `listen('handwriting-updated')`: `search/use-canvas-search.ts`
   - `UnlistenFn` type import: `page-frame/pm/code-block/run-view.ts`
   - plus ambient: `logger.ts` sink, `thumbnails/cache.ts`
4. Kill the transitive Tauri edges the inline sweep does not catch:
   - Split the `src/lib/sync/index.ts` barrel: it re-exports
     `utils/github-api` and `live/cloudflare-discovery` (both plugin-http),
     and editor files import the barrel for pure helpers/types
     (`clipboard/types.ts`, `page-frame/media-path/resolution.ts`,
     `page-frame/note-link/resolution.ts`, `pm/embed/url-detect.ts`). Pure
     types/helpers get a Tauri-free entry point.
   - `page-frame/note-link/preview-card.tsx` → `use-thumbnail-url` →
     `thumbnails/cache.ts` (Tauri fs). Thumbnail URL resolution goes behind
     the platform artifact-cache primitive.
5. Gate UI on capability presence: transcribe button, code-run button, PDF
   export entries, canvas search's handwriting layer. Presence ≠ health:
   keep the existing runtime-failure paths (e.g. transcription "unavailable"
   errors) — capability presence only controls whether the affordance exists.
6. Boundary enforcement: biome `noRestrictedImports` (severity `error` — the
   default is `warn`) banning `@tauri-apps/*` outside `src/platform/tauri/`
   plus an allowlist. The allowlist is bigger than just app chrome: updater,
   window-controls, tabs/multi-window, stronghold credentials, shutdown gate,
   fatal-error, rust-errors, mcp/runtime, sync repo implementations
   (`repo/local`, `repo/github`, `repo/cached/outbox`),
   `live/cloudflare-discovery`, `utils/github-api`, sidebar explorer imports,
   library import/export pages, settings sections, vitest setup. Each is
   app-side; none is reachable from the editor core after step 4.
   Convention (worth a lint if cheap): no module-scope `getPlatform()` reads —
   consumers read at call time, or a module imported before `setPlatform`
   snapshots undefined.
7. Test migration: `vitest.setup.ts` mocks `@tauri-apps/*` globally and four
   canvas test files mock Tauri modules directly (`page-frame-element`,
   `player-view`, `fetcher`, `links`). Replace with a
   `setPlatform(fakePlatform)` test helper — Phase 1's own verify step forces
   this, budget it.

Verify: `yarn typecheck` + `yarn test` pass; desktop app smoke run (record +
transcribe, run code block, export PDF, export markdown, link embeds, canvas
search); grep confirms no `@tauri-apps` import reachable from
`src/pages/canvas` (direct or via barrels).

## Phase 2 — extract `packages/editor`

1. Import-graph audit of `src/pages/canvas/**` (madge or similar) → classify
   every outward edge: move / inject / cut. Known edges to resolve: logger,
   user-prefs, i18n (catalogs are imported by `drawable-canvas.ts` and the
   audio element self-wraps in `I18nProvider`), keybinds, analytics,
   `src/components/ui` plus non-ui components (`floating-toolbar` imports
   swatches, `run-overlay` imports VirtualList).
2. The moved surface is roughly everything under `src/pages/canvas` except
   `index.tsx`, `hooks/`, `components/`, `search/`: `drawable-canvas`,
   `ydoc-manager`, element store + elements, tools, geometry, PM page-frame
   stack, clipboard, media import, pdf-renderer — plus canvas-root modules
   they depend on (`canvas-theme`, `canvas-viewport`, `canvas-pool`,
   `chrome-menu`, `y-fields`, `shape-recognizer`, `export/export-controller`,
   `pdf-element-export`) and pure lib modules
   (`pdf-export/{harvest,coords,color,contract,fonts}`,
   `code-runner/contract`, `note/{link-syntax,link-target,state-summary}`,
   `scratch-canvas`, `utils/{collision-helper,state-machine}`, `events`,
   `custom-colors`). The `Platform`/capability types move too (contracts live
   in the editor package; the app implements them).
3. Repository/VFS types are the extraction linchpin:
   `note-link/preview.ts` imports `type Repository` and
   `media-path/resolution.ts` imports repo-type values, so
   `sync/repo/types.ts` (or a pure split of it) moves into the package and
   the app's `src/lib/sync` imports VFS types from `@myelin/editor`. That
   inverts today's direction but is not circular — app-side `session.ts`
   importing `YDocManager` from the package is the correct app→package
   direction. `NoteSession`/sync stays app-side for now (the future guest
   client will need it packaged, but not in this refactor).
4. App consumes `@myelin/editor`. Package deps:
   yjs/prosemirror/codemirror/pdfjs — zero Tauri, zero app imports,
   compiler-enforced. Consumption model: source-consumed like `packages/ui`
   (raw `./src` export). This keeps `pdfjs-dist/...?url` and Tailwind classes
   working but pins consumers to Vite — accepted, both consumers (app,
   website) are Vite-based.
5. Styling: DOM-backed elements (audio player etc.) use Tailwind — the package
   needs the same setup as `packages/ui`.

Design constraint (not in scope to implement): the website must be able to
depend on this package with a minimal web `Platform` (all optional
capabilities absent, `noopTransport`, in-memory Y.Doc) instead of its current
vite-alias + tauri-shims approach. Nothing in the package may assume a
capability exists.

Verify: `yarn typecheck` + `yarn test`; desktop app runs; package has no
`@tauri-apps` or app-src imports (compiler + grep).

## Phase 3 — capability-aware sync (can trail Phases 1–2)

1. Peer presence hello/heartbeat (`src/lib/sync/live/protocol.ts`) advertises
   `capabilities: string[]`.
2. Transcription claims: presence-validated claims mirroring the existing
   `currentWriter` election (`live/peer-state.ts`). Claim = peerId written to
   the element YMap, valid only while that peer is live in the session. For an
   untranscribed element with no valid claim, the lowest-id capable peer
   self-elects. No wall-clock leases (clock skew); races resolve via Yjs LWW —
   worst case a duplicate Whisper run, converges. Offline case needs no claim:
   a sole client transcribes if capable. Amendments from review:
   - Claim is written the moment transcription starts, including the
     live-recording path (`player-view.tsx` starts Whisper during recording,
     but `audioData` lands with an empty transcript minutes before the
     transcript does — without an upfront claim every capable peer would
     self-elect in that window, duplicating work in the common case, not the
     edge case).
   - Election/claim eligibility mirrors `getCurrentWriter`'s `owner-device`
     filter — guest peers never claim.
   - Claims become inert once `transcript` is set (no cleanup needed; a stale
     claim without presence is already invalid).
   - Election needs consistent membership handling: a lower-id capable peer
     joining mid-job must respect an existing valid claim rather than steal —
     that is what the claim adds over pure election.
   - Same-device multi-window: peerId is shared across WebviewWindows
     (localStorage-backed), so two windows on one note would both consider a
     claim "theirs" — and both already compute `isWriter: true` today. Fix in
     scope: per-window session id (`createEphemeralPeerId` exists unused in
     `identity.ts`) combined with device-scoped tiebreak, or explicitly accept
     same-device duplicates and document it. Decide at implementation time;
     the existing writer-election bug can be fixed by the same mechanism.
3. `creatorPeerId` narrows to the recording slot only. Mic capture stays
   device-bound; web can still record (MediaRecorder) without being able to
   transcribe.
4. UI states replace the infinite spinner: "Transcribing on <peer>" /
   "Transcription available when a capable device opens this note" /
   actionable button when this client is capable.

Verify: two desktop instances, one with the transcription capability stubbed
off — the capable peer picks up the job; creator-device-gone scenario
recovers; incapable client never claims.

## Loose ends / risks

- note-index and handwriting pass absolute on-disk paths to Rust
  (`repository.getStoredAbsolutePath`) — Rust reads the JS-managed file
  layout. Stays desktop-only, but must live behind the capability interface so
  it never leaks into `packages/editor`. Note the integration point is the
  persistence layer, not canvas: `repo/base.ts` schedules
  `noteIndexService`/`handwritingService` on file save, so capability gating
  conditions `BaseRepository`, and any future web Repository reusing it must
  not drag those services in.
- `logger.ts` is imported by nearly every canvas module; its sink must be a
  platform primitive before extraction or it drags plugin-fs into the package.
- Extraction churn will conflict with `web-redesign` (vite alias `@` → app
  `src/` plus 7 tauri shims). Out of scope here, but that branch will need a
  follow-up port to `@myelin/editor` after this lands.
