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

Do not reuse `DrawableCanvas` directly. It is coupled to Yjs note elements,
editing tools, selection handles, DOM overlays, and note-specific commands.

## Repository Data

The current repository API exposes backlinks for one note. A global graph needs
one efficient read, so add a concrete method similar to:

```ts
getNoteGraph(): Promise<NoteGraphSource>
```

The repository-facing source type should live beside the repository interface if
TypeScript needs a named contract there. Render and layout types stay
feature-local under `src/pages/graph/`; the repository layer must not import
from a page module.

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
- Search: highlight and center the matched note when selected.
- Keyboard: Escape clears selection, Enter opens the selected note when focus is
  on the graph canvas or inspector action.

## Empty And Error States

- No canvas notes: show a quiet empty state with an action back to Library.
- Canvas notes but no links: show isolated nodes and explain that explicit note
  links will connect them.
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

Controller tests where practical:

- Hit testing selects the nearest node within clickable radius.
- Blank-space hit testing clears selection.
- Fit bounds include all graph nodes.

Manual Tauri verification:

- Open Graph tab from Library or command palette.
- Pan and zoom the canvas.
- Select a node and verify inspector counts/lists.
- Double-click a node and verify the note opens.
- Verify empty and no-link states using test repositories.

## Implementation Notes

- Keep changes surgical. Do not refactor the note canvas engine unless a small
  extraction is required for `CanvasViewport` reuse.
- Prefer named graph types over derived helper types.
- Keep graph strings in i18n message catalogs.
- Use `yarn` scripts for verification.
