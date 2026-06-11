# Graph View Design

## Context

Myelin is a local-first Tauri note workspace where canvas notes (`mcanvas`) can
link to one another with explicit `[[Note Name]]` references. The repository
already stores extracted note links in the manifest as `linksBySource`, and
current note navigation opens notes through the tab controller.

The graph view should feel like a natural Myelin workspace, not a detached
visualization demo. It should use the same quiet, editorial visual language as
the Library and Canvas surfaces.

## Approved Scope

Build a hybrid graph workspace:

- A global Graph tab that maps the workspace.
- Explicit `[[note links]]` only for graph relationships.
- Canvas rendering for the graph surface.
- Click to select a note.
- Double-click or inspector action to open the selected note.
- Pan, zoom, and fit controls.
- No manual node dragging or persisted graph positions in v1.

## Assumptions

- Graph nodes are non-system canvas notes (`mcanvas` files).
- Tags and folders are metadata only in v1. They do not create graph edges.
- Links without a resolved `targetId` are excluded from the graph.
- Multiple explicit links from one note to another render as a single edge with
  a count.
- Isolated notes are visible so the graph represents the full canvas-note
  workspace, not only connected components.

## Non-Goals

- Saved manual graph layouts.
- Tag, folder, or content-similarity edges.
- Editing links from the graph view.
- Creating notes directly from the graph view.
- Rendering graph nodes as thumbnails in v1.
- Full graph virtualization or worker-based layout.

## Architecture

Add a new `graph` tab target alongside `library`, `settings`, `canvas`, and
`image`. `PaneContent` will render `GraphPage` for that target.

Keep graph-specific implementation under `src/pages/graph/`:

- `types.ts`: named graph types such as `NoteGraph`, `NoteGraphNode`, and
  `NoteGraphEdge`.
- `build-note-graph.ts`: converts repository graph records into the renderable
  graph model.
- `graph-canvas-controller.ts`: owns canvas drawing, layout ticks, hit testing,
  selection, pan gestures, and double-click handling.
- `index.tsx`: page shell, toolbar, canvas element, empty states, and inspector.

Reuse only the canvas pieces that are already general enough:

- `CanvasViewport` for world/screen transforms, wheel zoom, view fitting, and
  content-bound clamping.
- The existing requestAnimationFrame loop pattern from the canvas page.

Before graph code imports `CanvasViewport`, decouple it from `DrawableCanvas`:

- Move the shared `Vector2` type out of `drawable-canvas.ts` into a neutral
  canvas-local file, or make `canvas-viewport.ts` define the type itself.
- Keep edit-mode behavior dormant for the graph view. The graph controller
  should use normal pan/zoom only and must not import `DrawableCanvas`.
- Do not move graph code into `src/pages/canvas/`; the shared direction is from
  graph to the small canvas viewport utility, not into the note editor engine.

Do not reuse `DrawableCanvas` directly. It is coupled to Yjs note elements,
editing tools, selection handles, DOM overlays, and note-specific commands.

## Repository Data

The current repository API exposes backlinks for one note. A global graph needs
one efficient read, so add this concrete method:

```ts
getNoteGraph(): Promise<RepositoryNoteGraph>
```

The repository-facing source types should live beside the repository interface.
Render and layout types stay feature-local under `src/pages/graph/`; the
repository layer must not import from a page module.

Concrete repository projection:

```ts
export interface RepositoryNoteGraphNode {
  id: VFSNodeId;
  name: string;
}

export interface RepositoryNoteGraphLink {
  sourceId: VFSNodeId;
  targetId: VFSNodeId | null;
  pageFrameId: string | null;
  title: string;
  snippet: string;
}

export interface RepositoryNoteGraph {
  nodes: RepositoryNoteGraphNode[];
  links: RepositoryNoteGraphLink[];
}
```

This is a read-only projection from the existing manifest. It does not require
a manifest migration and should not expose full manifest nodes to the graph
builder.

The source data should include:

- Non-system `mcanvas` file nodes.
- Stored explicit note links from `manifest.linksBySource`.

The graph builder should:

- Build one node per non-system `mcanvas` file.
- Build directed edges from source note to `targetId`.
- Drop links where either endpoint is missing or not a non-system `mcanvas`.
- Collapse duplicate source-target edges and store a count.
- Preserve outgoing and incoming edge lists for the inspector.

## Layout And Rendering

The graph canvas should own a lightweight force layout:

- Initial positions are deterministic from note ids so the first render is
  stable.
- Connected nodes attract.
- All nodes repel.
- The simulation settles over time and can continue at low intensity after data
  changes.
- Nodes are drawn as circles with labels at readable zoom levels.
- Edge arrows or direction cues can be subtle; the inspector carries precise
  direction details.

V1 performance constraints:

- Optimize for small and medium workspaces up to roughly 250 canvas notes.
- Stop or cool the simulation once average node movement is below a small
  threshold for several frames.
- For larger graphs, run fewer simulation ticks per frame, hide labels until
  zoomed in, and show a compact notice that layout may settle more slowly.
- Do not add worker-based layout, virtualization, or spatial indexing in v1
  unless testing shows the simpler loop cannot stay interactive.

Rendering should be DPR-aware and clear/redraw each frame. Hit testing should
run in world coordinates and use a screen-space minimum radius so nodes remain
clickable while zoomed out.

## UI

The Graph tab uses a full canvas workspace with a quiet right inspector.

Main surface:

- Title: `Graph`.
- Subtitle or filter label: `Explicit links`.
- Search input for finding notes in the current graph.
- Fit and zoom controls.
- Status text with note and link counts.
- Canvas dot background, matching the existing canvas tone.

Inspector:

- Empty state when nothing is selected.
- Selected note title.
- Incoming backlink count and outgoing link count.
- Primary action to open the note.
- Outgoing links list.
- Backlinks list.

The graph view should be reachable from the Library and command palette. A later
iteration can also open the same tab focused on the current note.

## Interaction

- Click blank space: clear selection.
- Click node: select node and update inspector.
- Double-click node: open the note in the current pane.
- Wheel or trackpad: pan, matching canvas behavior.
- Pinch or ctrl-wheel: zoom.
- Fit button: animate viewport to graph bounds.
- Search: show matching note results from the current graph; selecting a result
  centers and selects that node. A no-match state shows compact inline text and
  does not change the current graph selection.
- Keyboard: Escape clears selection, Enter opens the selected note when focus is
  on the graph canvas or inspector action.

## Empty And Error States

- No canvas notes: show a quiet empty state with an action back to Library.
- Canvas notes but no links: show isolated nodes and explain that explicit note
  links will connect them.
- Stale or unresolved link targets: exclude them from graph edges and graph
  counts in v1. Do not warn unless the repository graph load itself fails.
- Repository setup unavailable: match Library's repository setup messaging.
- Graph load failure: log through `Logger` and show a compact retry state.

## Testing

Unit tests:

- Graph builder includes all non-system canvas notes.
- Graph builder excludes non-canvas files and system nodes.
- Resolved explicit links become directed edges.
- Duplicate links collapse into one edge with a count.
- Missing or unresolved targets are ignored.
- Isolated canvas notes remain nodes.

Repository tests:

- New graph API works for the local repository.
- Cached repository delegates the graph API correctly.
- GitHub repository behavior follows existing repository parity expectations.

Tab and command tests:

- `TabTarget` supports `graph`, and target equality treats graph tabs as a
  single workspace-level tab.
- `PaneContent` routes a graph tab to `GraphPage`.
- Command palette exposes an Open Graph command on the right pages and opens the
  graph tab through the tab controller.

Controller tests where practical:

- Hit testing selects the nearest node within clickable radius.
- Blank-space hit testing clears selection.
- Fit bounds include all graph nodes.

Manual Tauri verification:

- Run final UI verification in the Tauri app using Tauri MCP where available,
  or computer use if Tauri MCP cannot attach. Browser or Playwright verification
  can supplement unit checks but does not satisfy the project requirement.
- Open Graph tab from Library or command palette.
- Pan and zoom the canvas.
- Select a node and verify inspector counts/lists.
- Double-click a node and verify the note opens.
- Verify empty, no-link, duplicate-link, stale-link, and resolved-link states
  using small fixture repositories.

## Implementation Success Criteria

- Graph data loads from a single repository graph projection, not from repeated
  backlink calls or document parsing during render.
- Graph-specific render/layout code lives under `src/pages/graph/`.
- The repository layer does not import from `src/pages/graph/`.
- `CanvasViewport` reuse does not introduce a dependency on `DrawableCanvas`.
- Explicit links produce directed graph edges; tags and folders produce none.
- Tab and command palette integration are covered by tests.
- Final UI behavior is verified in Tauri, not browser-only tooling.

## Implementation Notes

- Keep changes surgical. Do not refactor the note canvas engine unless a small
  extraction is required for `CanvasViewport` reuse.
- Prefer named graph types over derived helper types.
- Keep graph strings in i18n message catalogs.
- Use `yarn` scripts for verification.
