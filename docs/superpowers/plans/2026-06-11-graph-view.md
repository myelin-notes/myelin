# Graph View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Graph tab: a canvas-rendered workspace graph based only on explicit resolved `[[note links]]`.

**Architecture:** Repository code exposes a read-only graph projection from the existing manifest. Feature-local graph code under `src/pages/graph/` converts that projection into render/layout data, draws it on canvas using `CanvasViewport`, and provides a right inspector for selection and note opening. Shared changes are limited to the repository API, tab routing, command palette routing, i18n messages, and decoupling `CanvasViewport` from `DrawableCanvas`.

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, Vitest, existing canvas viewport utilities, existing repository abstractions, existing command palette and tab controller.

---

## File Structure

- Modify `src/lib/sync/repo/types.ts`: add repository-facing graph projection interfaces and `Repository.getNoteGraph()`.
- Modify `src/lib/sync/repo/shared.ts`: add pure `getNoteGraph(manifest)` projection helper.
- Modify `src/lib/sync/repo/base.ts`: expose `getNoteGraph()` through base repositories.
- Modify `src/lib/sync/repo/cached/index.ts`: delegate `getNoteGraph()` to the local cache.
- Modify `src/lib/sync/index.ts`: export repository graph projection types.
- Modify `src/test/repository-test-utils.ts`: move the existing canvas-note Yjs fixture helper here so repository graph tests exercise real link extraction.
- Modify tests in `src/lib/sync/repo/local.test.ts`, `src/lib/sync/repo/parity.test.ts`, and `src/lib/sync/repo/cached.test.ts`.
- Create `src/pages/canvas/geometry.ts`: shared `Vector2` type for canvas-local utilities.
- Modify `src/pages/canvas/canvas-viewport.ts`, `src/pages/canvas/drawable-canvas.ts`, and canvas files importing `Vector2` from `drawable-canvas.ts`.
- Create `src/pages/graph/types.ts`: feature-local render graph types.
- Create `src/pages/graph/build-note-graph.ts` and `src/pages/graph/build-note-graph.test.ts`.
- Create `src/pages/graph/graph-canvas-controller.ts` and `src/pages/graph/graph-canvas-controller.test.ts`.
- Create `src/pages/graph/index.tsx`: Graph page UI.
- Modify `src/lib/tabs/types.ts`, `src/lib/tabs/controller.ts`, `src/lib/tabs/controller.test.ts`, `src/components/layout/pane.tsx`, and `src/components/layout/tab-bar.tsx`.
- Modify `src/components/command-palette/types.ts`, `src/components/command-palette/items.ts`, `src/components/command-palette/items.test.ts`, and `src/components/command-palette/use-command-palette.ts`.
- Modify `src/lib/i18n/messages/en.ts`, `src/lib/i18n/messages/es.ts`, and `src/lib/i18n/messages/zh-Hans.ts`.

---

### Task 1: Repository Graph Projection

**Files:**
- Modify: `src/lib/sync/repo/types.ts`
- Modify: `src/lib/sync/repo/shared.ts`
- Modify: `src/lib/sync/repo/base.ts`
- Modify: `src/lib/sync/repo/cached/index.ts`
- Modify: `src/lib/sync/index.ts`
- Modify: `src/test/repository-test-utils.ts`
- Test: `src/lib/sync/repo/local.test.ts`
- Test: `src/lib/sync/repo/parity.test.ts`
- Test: `src/lib/sync/repo/cached.test.ts`

- [ ] **Step 1: Move the canvas note fixture helper to shared test utilities**

In `src/test/repository-test-utils.ts`, add these imports:

```ts
import type { VFSNodeId } from '@/lib/sync';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown/import';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
```

Add this exported helper:

```ts
export async function createCanvasNoteState(
  markdown: string,
  resolveNoteLinkId?: (title: string) => Promise<VFSNodeId | null>,
): Promise<{ update: Uint8Array; stateVector: Uint8Array }> {
  const doc = new Y.Doc();
  const ydocManager = new YDocManager(doc);
  await addMarkdownPageFrameToYDoc({
    ydocManager,
    markdown,
    resolveNoteLinkId,
  });
  return {
    update: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
  };
}
```

Remove the duplicate local `createCanvasNoteState` implementation from `src/lib/sync/repo/local.test.ts` and import the shared helper:

```ts
import { createCanvasNoteState } from '@/test/repository-test-utils';
```

- [ ] **Step 2: Write failing local repository graph tests**

Update the import from `./shared` in `src/lib/sync/repo/local.test.ts` to include `createFileNode`, `createEmptyManifest`, `getNoteGraph`, and `VFSManifest`:

```ts
import {
  createEmptyManifest,
  createFileNode,
  getNoteGraph,
  type VFSManifest,
} from './shared';
```

Add these tests inside `describe('LocalRepository', ...)`:

```ts
it('returns a note graph projection for non-system canvas notes', async () => {
  const repository = new LocalRepository('repositories/note-graph-test');
  await repository.initialize();

  const sourceId = await repository.createFile('Source', 'mcanvas', null);
  const targetId = await repository.createFile('Target', 'mcanvas', null);
  const otherId = await repository.createFile('Other', 'mcanvas', null);
  await repository.createFile('Image', 'png', null, new Uint8Array([1]));

  const note = await createCanvasNoteState(
    'See [[Target]], [[Target]], and [[Missing]].',
    async (title) => (title === 'Target' ? targetId : null),
  );

  await repository.pushUpdates(sourceId, note.update, {
    baseRevision: null,
    localStateVector: note.stateVector,
  });

  expect(await repository.getNoteGraph()).toEqual({
    nodes: [
      { id: sourceId, name: 'Source' },
      { id: targetId, name: 'Target' },
      { id: otherId, name: 'Other' },
    ],
    links: [
      {
        sourceId,
        targetId,
        pageFrameId: null,
        title: 'Target',
        snippet: 'See [[Target]], [[Target]], and [[Missing]].',
      },
      {
        sourceId,
        targetId,
        pageFrameId: null,
        title: 'Target',
        snippet: 'See [[Target]], [[Target]], and [[Missing]].',
      },
      {
        sourceId,
        targetId: null,
        pageFrameId: null,
        title: 'Missing',
        snippet: 'See [[Target]], [[Target]], and [[Missing]].',
      },
    ],
  });
});

it('excludes system canvas files from the note graph projection', async () => {
  const manifest = createEmptyManifest();
  const userId = 'user-note';
  const systemId = 'system-note';
  const now = Date.now();

  manifest.nodes[userId] = createFileNode(userId, 'User Note', 'mcanvas', null, now);
  manifest.nodes[systemId] = createFileNode(
    systemId,
    'System Note',
    'mcanvas',
    null,
    now,
    {
      kind: 'file-version',
      sourceFileId: userId,
      sourceFileType: 'mcanvas',
      sourceName: 'User Note',
      sourceRevision: 'rev',
      capturedAt: now,
      byteLength: 10,
    },
  );
  manifest.children.push(userId, systemId);
  manifest.linksBySource[userId] = [
    {
      targetId: systemId,
      pageFrameId: null,
      title: 'System Note',
      snippet: 'Old snapshot',
    },
  ];

  const graph = getNoteGraph(manifest as VFSManifest);

  expect(graph).toEqual({
    nodes: [{ id: userId, name: 'User Note' }],
    links: [
      {
        sourceId: userId,
        targetId: systemId,
        pageFrameId: null,
        title: 'System Note',
        snippet: 'Old snapshot',
      },
    ],
  });
});
```

- [ ] **Step 3: Write failing repository parity assertion**

In `src/lib/sync/repo/parity.test.ts`, import `createCanvasNoteState` from `@/test/repository-test-utils`, then add this graph assertion before deletion:

```ts
const graphSourceId = await repository.createFile('Graph Source', 'mcanvas', null);
const graphTargetId = await repository.createFile('Graph Target', 'mcanvas', null);
const graphNote = await createCanvasNoteState(
  'See [[Graph Target]].',
  async (title) => (title === 'Graph Target' ? graphTargetId : null),
);
await repository.pushUpdates(graphSourceId, graphNote.update, {
  baseRevision: null,
  localStateVector: graphNote.stateVector,
});

expect((await repository.getNoteGraph()).nodes.map((node) => node.id).sort()).toEqual(
  [fileId, graphSourceId, graphTargetId].sort(),
);

expect(await repository.getNoteGraph()).toMatchObject({
  links: [
    {
      sourceId: graphSourceId,
      targetId: graphTargetId,
      title: 'Graph Target',
    },
  ],
});
```

- [ ] **Step 4: Write failing cached repository delegation test**

In `src/lib/sync/repo/cached.test.ts`, import `createCanvasNoteState` from `@/test/repository-test-utils` and add:

```ts
it('serves note graph data from the local cache', async () => {
  const remote = new MemoryRemoteRepository();
  const cache = new LocalRepository('repositories/cached-graph-test');
  const repository = new CachedRepository(
    remote,
    cache,
    'repositories/cached-graph-test/outbox.json',
  );

  await repository.initialize();
  const sourceId = await repository.createFile('Source', 'mcanvas', null);
  const targetId = await repository.createFile('Target', 'mcanvas', null);

  const note = await createCanvasNoteState(
    'See [[Target]].',
    async (title) => (title === 'Target' ? targetId : null),
  );
  await repository.pushUpdates(sourceId, note.update, {
    baseRevision: null,
    localStateVector: note.stateVector,
  });

  const graph = await expectQuickLocalResult(repository.getNoteGraph());

  expect(graph.nodes.map((node) => node.id).sort()).toEqual(
    [sourceId, targetId].sort(),
  );
  expect(graph.links).toMatchObject([
    {
      sourceId,
      targetId,
      title: 'Target',
    },
  ]);
});
```

- [ ] **Step 5: Run repository tests to verify failure**

Run:

```bash
yarn vitest run src/lib/sync/repo/local.test.ts src/lib/sync/repo/parity.test.ts src/lib/sync/repo/cached.test.ts
```

Expected: FAIL with TypeScript or runtime errors for missing `getNoteGraph`.

- [ ] **Step 6: Implement repository projection types**

In `src/lib/sync/repo/types.ts`, add after `NoteBacklink`:

```ts
export interface RepositoryNoteGraphNode {
  id: VFSNodeId;
  name: string;
}

export interface RepositoryNoteGraphLink extends StoredNoteLink {
  sourceId: VFSNodeId;
}

export interface RepositoryNoteGraph {
  nodes: RepositoryNoteGraphNode[];
  links: RepositoryNoteGraphLink[];
}
```

Add to the `Repository` interface after `getBacklinks`:

```ts
getNoteGraph(): Promise<RepositoryNoteGraph>;
```

- [ ] **Step 7: Implement shared manifest projection**

In `src/lib/sync/repo/shared.ts`, add `RepositoryNoteGraph` to the type imports:

```ts
type RepositoryNoteGraph,
```

Add this helper near `getBacklinks`:

```ts
function isGraphCanvasNode(node: VFSNode | null | undefined): node is VFSFileNode {
  return node?.type === 'file' && node.fileType === 'mcanvas' && !isSystemNode(node);
}

export function getNoteGraph(manifest: VFSManifest): RepositoryNoteGraph {
  const nodes = Object.values(manifest.nodes)
    .filter(isGraphCanvasNode)
    .map((node) => ({
      id: node.id,
      name: node.name,
    }));

  const canvasNodeIds = new Set(nodes.map((node) => node.id));
  const links = Object.entries(manifest.linksBySource).flatMap(
    ([sourceId, sourceLinks]) => {
      if (!canvasNodeIds.has(sourceId)) {
        return [];
      }
      return sourceLinks.map((link) => ({
        ...link,
        sourceId,
      }));
    },
  );

  return { nodes, links };
}
```

- [ ] **Step 8: Expose projection through repositories**

In `src/lib/sync/repo/base.ts`, import `getNoteGraph` from `./shared` and `RepositoryNoteGraph` from `./types`, then add after `getBacklinks`:

```ts
async getNoteGraph(): Promise<RepositoryNoteGraph> {
  const { manifest } = await this.loadManifestImpl();
  return getNoteGraph(manifest);
}
```

In `src/lib/sync/repo/cached/index.ts`, add after `getBacklinks`:

```ts
async getNoteGraph(): Promise<RepositoryNoteGraph> {
  return this.cache.getNoteGraph();
}
```

Also import `RepositoryNoteGraph` from `../types` or the local type import block in that file.

- [ ] **Step 9: Export projection types**

In `src/lib/sync/index.ts`, add these to the repo type export block:

```ts
RepositoryNoteGraph,
RepositoryNoteGraphLink,
RepositoryNoteGraphNode,
```

- [ ] **Step 10: Run repository tests to verify pass**

Run:

```bash
yarn vitest run src/lib/sync/repo/local.test.ts src/lib/sync/repo/parity.test.ts src/lib/sync/repo/cached.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit repository projection**

```bash
git add src/lib/sync src/test/repository-test-utils.ts
git commit -m "feat: expose note graph repository data"
```

---

### Task 2: Decouple CanvasViewport From DrawableCanvas

**Files:**
- Create: `src/pages/canvas/geometry.ts`
- Modify: `src/pages/canvas/canvas-viewport.ts`
- Modify: `src/pages/canvas/drawable-canvas.ts`
- Modify: files under `src/pages/canvas/` that import `Vector2` from `drawable-canvas`
- Test: `src/pages/canvas/canvas-viewport.test.ts`

- [ ] **Step 1: Write failing import boundary test**

In `src/pages/canvas/canvas-viewport.test.ts`, add:

```ts
it('does not depend on DrawableCanvas exports', async () => {
  const moduleText = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./canvas-viewport.ts', import.meta.url), 'utf8'),
  );

  expect(moduleText).not.toContain("from './drawable-canvas'");
});
```

- [ ] **Step 2: Run viewport test to verify failure**

Run:

```bash
yarn vitest run src/pages/canvas/canvas-viewport.test.ts
```

Expected: FAIL because `canvas-viewport.ts` imports `Vector2` from `drawable-canvas`.

- [ ] **Step 3: Create geometry type**

Create `src/pages/canvas/geometry.ts`:

```ts
export interface Vector2 {
  x: number;
  y: number;
}
```

- [ ] **Step 4: Move imports to geometry**

In `src/pages/canvas/canvas-viewport.ts`, replace:

```ts
import type { Vector2 } from './drawable-canvas';
```

with:

```ts
import type { Vector2 } from './geometry';
```

In `src/pages/canvas/drawable-canvas.ts`, replace the inline type:

```ts
export type Vector2 = { x: number; y: number };
```

with:

```ts
export type { Vector2 } from './geometry';
```

For files that import `Vector2` from `DrawableCanvas` only as a type, update imports to use:

```ts
import type { Vector2 } from '@/pages/canvas/geometry';
```

Keep `DrawableCanvas` imports only where the class itself is used.

- [ ] **Step 5: Run viewport and typecheck**

Run:

```bash
yarn vitest run src/pages/canvas/canvas-viewport.test.ts
yarn typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit viewport decoupling**

```bash
git add src/pages/canvas
git commit -m "refactor: decouple canvas viewport geometry"
```

---

### Task 3: Feature-Local Graph Model Builder

**Files:**
- Create: `src/pages/graph/types.ts`
- Create: `src/pages/graph/build-note-graph.ts`
- Create: `src/pages/graph/build-note-graph.test.ts`

- [ ] **Step 1: Write graph builder tests**

Create `src/pages/graph/build-note-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { RepositoryNoteGraph } from '@/lib/sync';
import { buildNoteGraph } from './build-note-graph';

const source: RepositoryNoteGraph = {
  nodes: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ],
  links: [
    { sourceId: 'a', targetId: 'b', pageFrameId: null, title: 'Beta', snippet: 'See Beta' },
    { sourceId: 'a', targetId: 'b', pageFrameId: null, title: 'Beta', snippet: 'Again' },
    { sourceId: 'b', targetId: 'missing', pageFrameId: null, title: 'Missing', snippet: 'Gone' },
    { sourceId: 'c', targetId: null, pageFrameId: null, title: 'Unresolved', snippet: 'Draft' },
  ],
};

describe('buildNoteGraph', () => {
  it('keeps isolated nodes and collapses duplicate resolved edges', () => {
    const graph = buildNoteGraph(source);

    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges).toEqual([
      {
        id: 'a->b',
        sourceId: 'a',
        targetId: 'b',
        count: 2,
        snippets: ['See Beta', 'Again'],
      },
    ]);
  });

  it('precomputes incoming and outgoing edge lists for the inspector', () => {
    const graph = buildNoteGraph(source);

    expect(graph.nodesById.get('a')?.outgoingEdges.map((edge) => edge.id)).toEqual(['a->b']);
    expect(graph.nodesById.get('b')?.incomingEdges.map((edge) => edge.id)).toEqual(['a->b']);
    expect(graph.nodesById.get('c')?.incomingEdges).toEqual([]);
  });
});
```

- [ ] **Step 2: Run graph builder test to verify failure**

Run:

```bash
yarn vitest run src/pages/graph/build-note-graph.test.ts
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Add feature-local graph types**

Create `src/pages/graph/types.ts`:

```ts
import type { VFSNodeId } from '@/lib/sync';

export interface NoteGraphEdge {
  id: string;
  sourceId: VFSNodeId;
  targetId: VFSNodeId;
  count: number;
  snippets: string[];
}

export interface NoteGraphNode {
  id: VFSNodeId;
  name: string;
  incomingEdges: NoteGraphEdge[];
  outgoingEdges: NoteGraphEdge[];
}

export interface NoteGraph {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
  nodesById: Map<VFSNodeId, NoteGraphNode>;
}
```

- [ ] **Step 4: Implement graph builder**

Create `src/pages/graph/build-note-graph.ts`:

```ts
import type { RepositoryNoteGraph, VFSNodeId } from '@/lib/sync';
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from './types';

function edgeId(sourceId: VFSNodeId, targetId: VFSNodeId): string {
  return `${sourceId}->${targetId}`;
}

export function buildNoteGraph(source: RepositoryNoteGraph): NoteGraph {
  const nodes: NoteGraphNode[] = source.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    incomingEdges: [],
    outgoingEdges: [],
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map<string, NoteGraphEdge>();

  for (const link of source.links) {
    if (!link.targetId || !nodesById.has(link.sourceId) || !nodesById.has(link.targetId)) {
      continue;
    }

    const id = edgeId(link.sourceId, link.targetId);
    const existing = edgesById.get(id);
    if (existing) {
      existing.count += 1;
      existing.snippets.push(link.snippet);
      continue;
    }

    edgesById.set(id, {
      id,
      sourceId: link.sourceId,
      targetId: link.targetId,
      count: 1,
      snippets: [link.snippet],
    });
  }

  const edges = Array.from(edgesById.values());
  for (const edge of edges) {
    nodesById.get(edge.sourceId)?.outgoingEdges.push(edge);
    nodesById.get(edge.targetId)?.incomingEdges.push(edge);
  }

  return { nodes, edges, nodesById };
}
```

- [ ] **Step 5: Run graph builder test to verify pass**

Run:

```bash
yarn vitest run src/pages/graph/build-note-graph.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit graph model builder**

```bash
git add src/pages/graph
git commit -m "feat: build note graph model"
```

---

### Task 4: Graph Tab And Command Routing

**Files:**
- Modify: `src/lib/tabs/types.ts`
- Modify: `src/lib/tabs/controller.ts`
- Modify: `src/lib/tabs/controller.test.ts`
- Modify: `src/components/layout/pane.tsx`
- Modify: `src/components/layout/tab-bar.tsx`
- Modify: `src/components/command-palette/types.ts`
- Modify: `src/components/command-palette/items.ts`
- Modify: `src/components/command-palette/items.test.ts`
- Modify: `src/components/command-palette/use-command-palette.ts`
- Create: `src/pages/graph/index.tsx`
- Modify: `src/lib/i18n/messages/en.ts`
- Modify: `src/lib/i18n/messages/es.ts`
- Modify: `src/lib/i18n/messages/zh-Hans.ts`

- [ ] **Step 1: Write tab controller tests**

In `src/lib/tabs/controller.test.ts`, add:

```ts
it('reuses the workspace graph tab in the same pane', () => {
  const controller = new TabStateController();
  const paneId = focusedPane(controller).id;

  const firstId = controller.openTab({ type: 'graph' }, 'Graph', paneId);
  const secondId = controller.openTab({ type: 'graph' }, 'Graph again', paneId);

  expect(secondId).toBe(firstId);
  expect(tabTitles(rootPane(controller))).toEqual(['Library', 'Graph again']);
  expectValidWindowState(controller.getSnapshot());
});
```

- [ ] **Step 2: Write command palette tests**

In `src/components/command-palette/items.test.ts`, update expected settings globals:

```ts
expect(commandIdsForPage('settings')).toEqual([
  'open-note',
  'create-note',
  'open-graph',
]);
```

Add to page mapping test:

```ts
expect(commandPalettePageFromTabTarget({ type: 'graph' })).toBe('graph');
```

Add:

```ts
it('opens graph from command items', () => {
  const opened: string[] = [];
  const items = createCommandPaletteItems({
    activeKeybindingActions: [],
    currentPage: 'library',
    strings: en,
    isImportingMarkdown: false,
    isRefreshingRepository: false,
    canRefreshRepository: false,
    createNote: async () => {},
    openGraph: () => opened.push('graph'),
    openPalette: () => {},
    refreshRepository: async () => {},
    toggleLibraryView: () => {},
    triggerKeybindingAction: () => {},
    triggerCanvasMarkdownImport: () => {},
    triggerLibraryMarkdownImport: () => {},
  });

  items.find((item) => item.id === 'open-graph')?.onSelect();

  expect(opened).toEqual(['graph']);
});
```

Update `commandIdsForPage` helper context with `openGraph: () => {}`.

- [ ] **Step 3: Run tab and command tests to verify failure**

Run:

```bash
yarn vitest run src/lib/tabs/controller.test.ts src/components/command-palette/items.test.ts
```

Expected: FAIL because `graph` target and command item do not exist.

- [ ] **Step 4: Add graph target and routing**

In `src/lib/tabs/types.ts`, add to `TabTarget`:

```ts
| { type: 'graph' }
```

In `src/lib/tabs/controller.ts`, update `targetsEqual`:

```ts
case 'library':
case 'settings':
case 'graph':
  return true;
```

Create minimal `src/pages/graph/index.tsx`:

```tsx
export function GraphPage() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-page text-text-secondary">
      Graph
    </div>
  );
}
```

In `src/components/layout/pane.tsx`, import `GraphPage` and add:

```tsx
case 'graph':
  return <GraphPage />;
```

In `src/components/layout/tab-bar.tsx`, import `Network` from `lucide-react` and add:

```tsx
case 'graph':
  return <Network className="size-3 shrink-0" />;
```

- [ ] **Step 5: Add command palette graph command**

In `src/components/command-palette/types.ts`, update:

```ts
export type CommandPalettePage =
  | 'canvas'
  | 'graph'
  | 'library'
  | 'settings'
  | 'unknown';
```

In `src/components/command-palette/items.ts`, import `Network`, add `openGraph` to `CommandPaletteItemContext`, destructure it, and insert after create note:

```ts
{
  id: 'open-graph',
  label: strings.commandPalette.commands.openGraph.label,
  description: strings.commandPalette.commands.openGraph.description,
  keywords: ['graph', 'map', 'links', 'backlinks'],
  section: strings.commandPalette.sections.commands,
  icon: Network,
  onSelect: openGraph,
},
```

Update `commandPalettePageFromTabTarget`:

```ts
case 'graph':
  return 'graph';
```

In `src/components/command-palette/use-command-palette.ts`, add:

```ts
const openGraph = useCallback(() => {
  closePalette();
  tabController.openTab({ type: 'graph' }, strings.graph.title);
}, [closePalette, strings.graph.title, tabController]);
```

Pass `openGraph` into `createCommandPaletteItems` and include it in the dependency list.

- [ ] **Step 6: Add i18n strings**

In each message catalog, add `graph` near `library`:

```ts
graph: {
  title: 'Graph',
  explicitLinks: 'Explicit links',
}
```

In `en.ts`, add:

```ts
openGraph: {
  label: 'Open graph',
  description: 'Map explicit links between canvas notes',
},
```

For `es.ts` and `zh-Hans.ts`, add straightforward translations or English fallback text matching the existing catalog style.

- [ ] **Step 7: Run tab and command tests to verify pass**

Run:

```bash
yarn vitest run src/lib/tabs/controller.test.ts src/components/command-palette/items.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit graph routing**

```bash
git add src/lib/tabs src/components/layout src/components/command-palette src/pages/graph src/lib/i18n/messages
git commit -m "feat: add graph tab routing"
```

---

### Task 5: Graph Canvas Controller

**Files:**
- Create: `src/pages/graph/graph-canvas-controller.ts`
- Create: `src/pages/graph/graph-canvas-controller.test.ts`

- [ ] **Step 1: Write controller tests**

Create `src/pages/graph/graph-canvas-controller.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { NoteGraph } from './types';
import {
  createGraphLayout,
  getGraphBounds,
  hitTestGraphNode,
  tickGraphLayout,
} from './graph-canvas-controller';

const graph: NoteGraph = {
  nodes: [
    { id: 'a', name: 'Alpha', incomingEdges: [], outgoingEdges: [] },
    { id: 'b', name: 'Beta', incomingEdges: [], outgoingEdges: [] },
  ],
  edges: [{ id: 'a->b', sourceId: 'a', targetId: 'b', count: 1, snippets: ['See Beta'] }],
  nodesById: new Map(),
};

graph.nodesById.set('a', graph.nodes[0]);
graph.nodesById.set('b', graph.nodes[1]);

describe('graph layout helpers', () => {
  it('creates deterministic node positions', () => {
    const first = createGraphLayout(graph);
    const second = createGraphLayout(graph);

    expect(first.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y }))).toEqual(
      second.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    );
  });

  it('hit tests nodes with a screen-space minimum radius', () => {
    const layout = createGraphLayout(graph);
    const node = layout.nodes[0];

    expect(hitTestGraphNode(layout, { x: node.x + 4, y: node.y }, 1)?.id).toBe(node.id);
    expect(hitTestGraphNode(layout, { x: node.x + 80, y: node.y }, 1)).toBeNull();
  });

  it('computes graph bounds including node radius', () => {
    const layout = createGraphLayout(graph);
    const bounds = getGraphBounds(layout);

    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('cools the layout after ticks', () => {
    const layout = createGraphLayout(graph);
    const initialAlpha = layout.alpha;

    tickGraphLayout(layout, 1 / 60);

    expect(layout.alpha).toBeLessThan(initialAlpha);
  });
});
```

- [ ] **Step 2: Run controller tests to verify failure**

Run:

```bash
yarn vitest run src/pages/graph/graph-canvas-controller.test.ts
```

Expected: FAIL because controller helpers do not exist.

- [ ] **Step 3: Implement layout helpers and controller shell**

Create `src/pages/graph/graph-canvas-controller.ts` with exported helpers and a controller class:

```ts
import { CanvasViewport } from '@/pages/canvas/canvas-viewport';
import type { Vector2 } from '@/pages/canvas/geometry';
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from './types';

const NODE_RADIUS = 30;
const MIN_HIT_RADIUS_SCREEN = 14;
const LINK_DISTANCE = 150;
const REPULSION = 9000;
const SPRING = 0.02;
const FRICTION = 0.86;
const COOLING = 0.985;
const MIN_ALPHA = 0.02;

export interface GraphLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  source: NoteGraphNode;
}

export interface GraphLayoutEdge {
  id: string;
  source: GraphLayoutNode;
  target: GraphLayoutNode;
  sourceEdge: NoteGraphEdge;
}

export interface GraphLayout {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  alpha: number;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initialPosition(id: string, index: number, total: number): Vector2 {
  const hash = hashString(id);
  const angle = total <= 1 ? 0 : (Math.PI * 2 * index) / total;
  const radius = 120 + (hash % 90);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function createGraphLayout(graph: NoteGraph): GraphLayout {
  const nodes = graph.nodes.map((node, index) => {
    const point = initialPosition(node.id, index, graph.nodes.length);
    return {
      id: node.id,
      label: node.name,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      radius: NODE_RADIUS,
      source: node,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge) => {
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    return source && target
      ? [{ id: edge.id, source, target, sourceEdge: edge }]
      : [];
  });

  return { nodes, edges, alpha: 1 };
}

export function tickGraphLayout(layout: GraphLayout, deltaTime: number): void {
  if (layout.alpha < MIN_ALPHA) {
    return;
  }

  for (let i = 0; i < layout.nodes.length; i += 1) {
    const left = layout.nodes[i];
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const right = layout.nodes[j];
      const dx = right.x - left.x || 0.01;
      const dy = right.y - left.y || 0.01;
      const distanceSq = Math.max(dx * dx + dy * dy, 100);
      const force = (REPULSION * layout.alpha) / distanceSq;
      const distance = Math.sqrt(distanceSq);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      left.vx -= fx;
      left.vy -= fy;
      right.vx += fx;
      right.vy += fy;
    }
  }

  for (const edge of layout.edges) {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const force = (distance - LINK_DISTANCE) * SPRING * layout.alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    edge.source.vx += fx;
    edge.source.vy += fy;
    edge.target.vx -= fx;
    edge.target.vy -= fy;
  }

  const step = Math.min(deltaTime * 60, 2);
  for (const node of layout.nodes) {
    node.vx *= FRICTION;
    node.vy *= FRICTION;
    node.x += node.vx * step;
    node.y += node.vy * step;
  }
  layout.alpha *= COOLING;
}

export function getGraphBounds(layout: GraphLayout): DOMRect {
  if (layout.nodes.length === 0) {
    return new DOMRect(-100, -100, 200, 200);
  }
  const left = Math.min(...layout.nodes.map((node) => node.x - node.radius));
  const top = Math.min(...layout.nodes.map((node) => node.y - node.radius));
  const right = Math.max(...layout.nodes.map((node) => node.x + node.radius));
  const bottom = Math.max(...layout.nodes.map((node) => node.y + node.radius));
  return new DOMRect(left, top, right - left, bottom - top);
}

export function hitTestGraphNode(
  layout: GraphLayout,
  world: Vector2,
  zoom: number,
): GraphLayoutNode | null {
  const minRadius = MIN_HIT_RADIUS_SCREEN / Math.max(zoom, 0.01);
  for (let index = layout.nodes.length - 1; index >= 0; index -= 1) {
    const node = layout.nodes[index];
    const radius = Math.max(node.radius, minRadius);
    if (Math.hypot(world.x - node.x, world.y - node.y) <= radius) {
      return node;
    }
  }
  return null;
}

export class GraphCanvasController {
  public readonly viewport: CanvasViewport;
  private readonly ctx: CanvasRenderingContext2D;
  private layout: GraphLayout;
  private selectedId: string | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    graph: NoteGraph,
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Could not create graph canvas context');
    }
    this.ctx = ctx;
    this.viewport = new CanvasViewport(canvas);
    this.layout = createGraphLayout(graph);
    this.viewport.setContentBoundsProvider(() => getGraphBounds(this.layout));
  }

  setGraph(graph: NoteGraph): void {
    this.layout = createGraphLayout(graph);
    this.viewport.setContentBoundsProvider(() => getGraphBounds(this.layout));
  }

  setSelectedId(id: string | null): void {
    this.selectedId = id;
  }

  hitTest(screen: Vector2): GraphLayoutNode | null {
    return hitTestGraphNode(
      this.layout,
      this.viewport.screenToWorld(screen),
      this.viewport.zoom,
    );
  }

  fit(): void {
    this.viewport.animateViewToFitRect(getGraphBounds(this.layout), {
      widthRatio: 0.72,
      heightRatio: 0.72,
    });
  }

  redraw(deltaTime: number): void {
    tickGraphLayout(this.layout, deltaTime);
    this.draw();
  }

  destroy(): void {
    this.viewport.destroy();
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = '#f7f9fb';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.scale(this.viewport.zoom, this.viewport.zoom);
    this.ctx.translate(this.viewport.offset.x, this.viewport.offset.y);
    this.drawEdges();
    this.drawNodes();
    this.ctx.restore();
  }

  private drawEdges(): void {
    this.ctx.strokeStyle = 'rgba(141, 154, 167, 0.72)';
    this.ctx.lineWidth = 1.4 / this.viewport.zoom;
    for (const edge of this.layout.edges) {
      this.ctx.beginPath();
      this.ctx.moveTo(edge.source.x, edge.source.y);
      this.ctx.lineTo(edge.target.x, edge.target.y);
      this.ctx.stroke();
    }
  }

  private drawNodes(): void {
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `${12 / this.viewport.zoom}px Inter, sans-serif`;
    for (const node of this.layout.nodes) {
      const selected = node.id === this.selectedId;
      this.ctx.fillStyle = selected ? '#1c2738' : '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      this.ctx.fill();
      if (this.viewport.zoom >= 0.45) {
        this.ctx.fillStyle = selected ? '#ffffff' : '#43474a';
        this.ctx.fillText(node.label, node.x, node.y);
      }
    }
  }
}
```

- [ ] **Step 4: Run controller tests**

Run:

```bash
yarn vitest run src/pages/graph/graph-canvas-controller.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit graph controller**

```bash
git add src/pages/graph/graph-canvas-controller.ts src/pages/graph/graph-canvas-controller.test.ts
git commit -m "feat: add graph canvas controller"
```

---

### Task 6: Graph Page UI And Interactions

**Files:**
- Modify: `src/pages/graph/index.tsx`
- Modify: `src/lib/i18n/messages/en.ts`
- Modify: `src/lib/i18n/messages/es.ts`
- Modify: `src/lib/i18n/messages/zh-Hans.ts`

- [ ] **Step 1: Add graph page strings**

In all message catalogs, expand `graph` to include:

```ts
graph: {
  title: 'Graph',
  explicitLinks: 'Explicit links',
  searchPlaceholder: 'Search graph...',
  fit: 'Fit',
  openNote: 'Open note',
  emptySelection: 'Select a note to inspect its links.',
  noCanvasNotes: 'No canvas notes yet.',
  noLinks: 'Add explicit note links to connect this graph.',
  outgoing: 'Outgoing links',
  backlinks: 'Backlinks',
  graphStats: (notes: number, links: number) =>
    `${notes} note${notes === 1 ? '' : 's'}, ${links} link${links === 1 ? '' : 's'}`,
  linkCount: (incoming: number, outgoing: number) =>
    `${outgoing} outgoing, ${incoming} backlink${incoming === 1 ? '' : 's'}`,
}
```

Use these catalog values:
- `es.ts`: `title: 'Grafo'`, `explicitLinks: 'Enlaces explícitos'`, `searchPlaceholder: 'Buscar en el grafo...'`, `fit: 'Ajustar'`, `openNote: 'Abrir nota'`, `emptySelection: 'Selecciona una nota para inspeccionar sus enlaces.'`, `noCanvasNotes: 'Aún no hay notas de lienzo.'`, `noLinks: 'Agrega enlaces explícitos entre notas para conectar este grafo.'`, `outgoing: 'Enlaces salientes'`, `backlinks: 'Backlinks'`.
- `zh-Hans.ts`: `title: '图谱'`, `explicitLinks: '显式链接'`, `searchPlaceholder: '搜索图谱...'`, `fit: '适应'`, `openNote: '打开笔记'`, `emptySelection: '选择一条笔记以查看它的链接。'`, `noCanvasNotes: '还没有画布笔记。'`, `noLinks: '添加显式笔记链接来连接此图谱。'`, `outgoing: '传出链接'`, `backlinks: '反向链接'`.

- [ ] **Step 2: Implement page shell**

Replace `src/pages/graph/index.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note/navigation';
import { useRepository, type VFSNodeId } from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { cn } from '@/lib/utils';
import { buildNoteGraph } from './build-note-graph';
import { GraphCanvasController } from './graph-canvas-controller';
import type { NoteGraph, NoteGraphNode } from './types';

const logger = new Logger('GraphPage');

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; graph: NoteGraph }
  | { status: 'error' };

function startGraphAnimationLoop(
  controller: Pick<GraphCanvasController, 'redraw'>,
): () => void {
  let previousTime = 0;
  let frameId = 0;
  let stopped = false;

  function animate(time: number) {
    if (stopped) {
      return;
    }
    const dt = (time - previousTime) / 1000;
    previousTime = time;
    controller.redraw(dt);
    frameId = requestAnimationFrame(animate);
  }

  frameId = requestAnimationFrame(animate);
  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
}

export function GraphPage() {
  const strings = useMessages();
  const repository = useRepository();
  const tabController = useTabController();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<GraphCanvasController | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<VFSNodeId | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: 'loading' });
    repository
      .getNoteGraph()
      .then((source) => {
        if (!cancelled) {
          setLoadState({ status: 'ready', graph: buildNoteGraph(source) });
        }
      })
      .catch((error) => {
        logger.error('Failed to load note graph', error);
        if (!cancelled) {
          setLoadState({ status: 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const graph = loadState.status === 'ready' ? loadState.graph : null;
  const selectedNode = selectedId && graph ? graph.nodesById.get(selectedId) ?? null : null;
  const matches = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed || !graph) {
      return [];
    }
    return graph.nodes.filter((node) =>
      node.name.toLocaleLowerCase().includes(trimmed),
    );
  }, [graph, query]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) {
      return;
    }

    const controller = new GraphCanvasController(canvas, graph);
    controllerRef.current = controller;
    controller.setSelectedId(selectedId);
    controller.fit();
    const stopAnimation = startGraphAnimationLoop(controller);

    return () => {
      stopAnimation();
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [graph]);

  useEffect(() => {
    controllerRef.current?.setSelectedId(selectedId);
  }, [selectedId]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  const openSelectedNode = useCallback(
    (node: NoteGraphNode | null) => {
      if (!node) {
        return;
      }
      openNote(tabController, { fileType: 'mcanvas', id: node.id }, node.name);
    },
    [tabController],
  );

  const selectNode = useCallback((node: NoteGraphNode) => {
    setSelectedId(node.id);
  }, []);

  return (
    <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-page">
      <section className="relative min-w-0">
        <div className="pointer-events-none absolute top-6 left-8 z-10">
          <h1 className="font-heading font-normal text-4xl text-text-primary leading-none">
            {strings.graph.title}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {strings.graph.explicitLinks}
          </p>
        </div>
        <div className="absolute top-6 right-8 z-10 flex items-center gap-2">
          <div className="flex h-9 items-center gap-2 rounded-xl bg-card/85 px-3 shadow-ambient backdrop-blur-[24px]">
            <Search className="size-3.5 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.graph.searchPlaceholder}
              className="w-40 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
          <button
            type="button"
            onClick={() => controllerRef.current?.fit()}
            className="h-9 rounded-xl bg-card/85 px-3 text-sm text-text-secondary shadow-ambient backdrop-blur-[24px] transition-colors hover:bg-card hover:text-text-primary"
          >
            {strings.graph.fit}
          </button>
        </div>

        {matches.length > 0 && (
          <div className="absolute top-18 right-8 z-20 flex w-56 flex-col gap-1 rounded-xl bg-card/95 p-1 shadow-ambient backdrop-blur-[24px]">
            {matches.slice(0, 8).map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  selectNode(node);
                  setQuery('');
                }}
                className="rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-hover-tint hover:text-text-primary"
              >
                {node.name}
              </button>
            ))}
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="h-full w-full"
          onClick={(event) => {
            const controller = controllerRef.current;
            if (!controller) {
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const hit = controller.hitTest({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
            setSelectedId(hit?.id ?? null);
          }}
          onDoubleClick={(event) => {
            const controller = controllerRef.current;
            if (!controller || !graph) {
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const hit = controller.hitTest({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
            if (hit) {
              openSelectedNode(graph.nodesById.get(hit.id) ?? null);
            }
          }}
        />

        <div className="absolute bottom-6 left-8 rounded-xl bg-card/85 px-3 py-2 text-text-muted text-xs shadow-ambient backdrop-blur-[24px]">
          {graph
            ? strings.graph.graphStats(graph.nodes.length, graph.edges.length)
            : strings.commandPalette.loading}
        </div>
      </section>

      <GraphInspector
        graph={graph}
        node={selectedNode}
        onOpen={() => openSelectedNode(selectedNode)}
      />
    </div>
  );
}

function GraphInspector({
  graph,
  node,
  onOpen,
}: {
  graph: NoteGraph | null;
  node: NoteGraphNode | null;
  onOpen: () => void;
}) {
  const strings = useMessages();

  return (
    <aside className="flex min-h-0 flex-col gap-6 bg-surface px-6 py-7">
      {!node ? (
        <p className="text-sm text-text-muted">{strings.graph.emptySelection}</p>
      ) : (
        <>
          <div>
            <h2 className="font-heading font-normal text-3xl text-text-primary leading-tight">
              {node.name}
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              {strings.graph.linkCount(
                node.incomingEdges.length,
                node.outgoingEdges.length,
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="h-9 rounded-xl bg-accent-dark px-3 text-sm text-text-on-dark transition-colors hover:bg-accent-dark/90"
          >
            {strings.graph.openNote}
          </button>
          <GraphEdgeList
            title={strings.graph.outgoing}
            edges={node.outgoingEdges}
            graph={graph}
            endpoint="target"
          />
          <GraphEdgeList
            title={strings.graph.backlinks}
            edges={node.incomingEdges}
            graph={graph}
            endpoint="source"
          />
        </>
      )}
    </aside>
  );
}

function GraphEdgeList({
  title,
  edges,
  graph,
  endpoint,
}: {
  title: string;
  edges: NoteGraphNode['outgoingEdges'];
  graph: NoteGraph | null;
  endpoint: 'source' | 'target';
}) {
  return (
    <section className="min-h-0">
      <h3 className="font-medium text-[11px] text-text-muted uppercase tracking-[0.08em]">
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-2">
        {edges.map((edge) => {
          const nodeId = endpoint === 'source' ? edge.sourceId : edge.targetId;
          const label = graph?.nodesById.get(nodeId)?.name ?? nodeId;
          return (
          <div
            key={edge.id}
            className={cn('rounded-lg bg-card px-3 py-2 text-sm text-text-secondary')}
          >
            {label}
          </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Run typecheck and targeted tests**

Run:

```bash
yarn typecheck
yarn vitest run src/pages/graph/build-note-graph.test.ts src/pages/graph/graph-canvas-controller.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit graph page UI**

```bash
git add src/pages/graph src/lib/i18n/messages
git commit -m "feat: render graph workspace"
```

---

### Task 7: Full Verification And Tauri Smoke Test

**Files:**
- No planned source edits unless verification finds defects.

- [ ] **Step 1: Run all unit tests**

Run:

```bash
yarn test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
yarn typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
yarn lint
```

Expected: PASS.

- [ ] **Step 4: Build frontend**

Run:

```bash
yarn build
```

Expected: PASS.

- [ ] **Step 5: Start Tauri app**

Run:

```bash
yarn tauri dev
```

Expected: app launches. Keep this session running until verification finishes.

- [ ] **Step 6: Connect Tauri MCP**

Use the Tauri MCP tools:

```text
driver_session start
webview_dom_snapshot accessibility
```

Expected: Tauri MCP connects and can read the app accessibility tree.

When Tauri MCP cannot connect, use computer-use style inspection of the running native app and record that Tauri MCP was unavailable in the final implementation notes.

- [ ] **Step 7: Verify graph command path**

In the running Tauri app:

1. Open the command palette.
2. Run `Open graph`.
3. Confirm a `Graph` tab opens.
4. Confirm the graph page shows an empty/no-link/linked state matching the current repository.

Expected: Graph tab opens without console errors.

- [ ] **Step 8: Verify interaction path**

Using a fixture repository with at least two linked notes:

1. Open Graph.
2. Pan with trackpad/wheel.
3. Zoom with pinch or ctrl-wheel.
4. Click a node.
5. Confirm inspector shows note title and incoming/outgoing counts.
6. Double-click the node.
7. Confirm the canvas note opens in the current pane.

Expected: all actions work in the native Tauri app.

- [ ] **Step 9: Confirm no verification-only changes remain**

Run:

```bash
git status --short
```

Expected: clean worktree after the task commits above. Do not create an empty commit.
