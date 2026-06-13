import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Search } from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note/navigation';
import { useRepository, type VFSNodeId } from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { buildNoteGraph } from './build-note-graph';
import { GraphCanvasController } from './graph-canvas-controller';
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from './types';

const logger = new Logger('GraphPage');

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; graph: NoteGraph }
  | { status: 'error' };

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

function startGraphAnimationLoop(
  controller: Pick<GraphCanvasController, 'redraw'>,
): () => void {
  let previousTime: number | null = null;
  let frameId = 0;
  let stopped = false;

  function animate(time: number) {
    if (stopped) {
      return;
    }
    const dt = previousTime === null ? 0 : (time - previousTime) / 1000;
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

function graphMessage(
  loadState: LoadState,
  graph: NoteGraph | null,
  strings: Messages,
): string {
  if (loadState.status === 'loading') {
    return strings.commandPalette.loading;
  }
  if (loadState.status === 'error') {
    return strings.graph.loadFailed;
  }
  if (!graph || graph.nodes.length === 0) {
    return strings.graph.noCanvasNotes;
  }
  if (graph.edges.length === 0) {
    return strings.graph.noLinks;
  }
  return strings.graph.graphStats(graph.nodes.length, graph.edges.length);
}

export function GraphPage() {
  const strings = useMessages();
  const repository = useRepository();
  const tabController = useTabController();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<GraphCanvasController | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const selectedIdRef = useRef<VFSNodeId | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [selectedId, setSelectedId] = useState<VFSNodeId | null>(null);
  const [query, setQuery] = useState('');

  const graph = loadState.status === 'ready' ? loadState.graph : null;
  const selectedNode =
    selectedId && graph ? (graph.nodesById.get(selectedId) ?? null) : null;
  const statusMessage = graphMessage(loadState, graph, strings);

  const matches = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed || !graph) {
      return [];
    }
    return graph.nodes.filter((node) =>
      node.name.toLocaleLowerCase().includes(trimmed),
    );
  }, [graph, query]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width === width && canvas.height === height) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
  }, []);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) {
      return;
    }

    resizeCanvas();
    const controller = new GraphCanvasController(canvas, graph);
    controllerRef.current = controller;
    controller.setSelectedId(selectedIdRef.current);
    controller.fit();
    const stopAnimation = startGraphAnimationLoop(controller);

    return () => {
      stopAnimation();
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [graph, resizeCanvas]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    controllerRef.current?.setSelectedId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    const canvas = canvasRef.current;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(resizeCanvas);
    if (canvas) {
      observer?.observe(canvas);
    }
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      observer?.disconnect();
    };
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

  const selectNode = useCallback((id: VFSNodeId) => {
    setSelectedId(id);
    controllerRef.current?.focusNode(id);
  }, []);

  const screenPointForEvent = useCallback(
    (
      event:
        | React.MouseEvent<HTMLCanvasElement>
        | React.PointerEvent<HTMLCanvasElement>,
    ) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    },
    [],
  );

  return (
    <div className="grid h-full w-full grid-cols-1 grid-rows-[minmax(0,1fr)_13rem] overflow-hidden bg-page lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
      <section className="relative min-h-0 min-w-0">
        <div className="pointer-events-none absolute top-6 left-8 z-10">
          <h1 className="font-heading font-normal text-4xl text-text-primary leading-none">
            {strings.graph.title}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {strings.graph.explicitLinks}
          </p>
        </div>
        <div className="absolute top-6 right-8 z-10 flex items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-xl bg-card/85 px-3 shadow-ambient backdrop-blur-[24px]">
            <Search className="size-3.5 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={strings.graph.searchPlaceholder}
              className="w-40 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </label>
          <button
            type="button"
            onClick={() => controllerRef.current?.fit()}
            className="flex h-9 items-center gap-2 rounded-xl bg-card/85 px-3 text-sm text-text-secondary shadow-ambient backdrop-blur-[24px] transition-colors hover:bg-card hover:text-text-primary"
          >
            <Maximize2 className="size-3.5" />
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
                  setSelectedId(node.id);
                  controllerRef.current?.focusNode(node.id);
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
          aria-label={strings.graph.title}
          className="h-full w-full touch-none"
          onPointerDown={(event) => {
            dragRef.current = {
              pointerId: event.pointerId,
              lastX: event.clientX,
              lastY: event.clientY,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const controller = controllerRef.current;
            const drag = dragRef.current;
            if (!controller || !drag || drag.pointerId !== event.pointerId) {
              return;
            }
            const dx = event.clientX - drag.lastX;
            const dy = event.clientY - drag.lastY;
            if (Math.abs(dx) + Math.abs(dy) > 1) {
              drag.moved = true;
            }
            drag.lastX = event.clientX;
            drag.lastY = event.clientY;
            controller.viewport.cancelAnimation();
            controller.viewport.panBy(
              dx / controller.viewport.zoom,
              dy / controller.viewport.zoom,
            );
          }}
          onPointerUp={(event) => {
            const controller = controllerRef.current;
            const drag = dragRef.current;
            if (drag?.pointerId === event.pointerId) {
              dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            if (!controller || drag?.moved) {
              return;
            }
            const hit = controller.hitTest(screenPointForEvent(event));
            setSelectedId(hit?.id ?? null);
          }}
          onPointerCancel={(event) => {
            const drag = dragRef.current;
            if (drag?.pointerId === event.pointerId) {
              dragRef.current = null;
            }
          }}
          onDoubleClick={(event) => {
            const controller = controllerRef.current;
            if (!controller) {
              return;
            }
            const hit = controller.hitTest(screenPointForEvent(event));
            if (hit) {
              openSelectedNode(hit.source);
            }
          }}
        />

        <div className="absolute bottom-6 left-8 rounded-xl bg-card/85 px-3 py-2 text-text-muted text-xs shadow-ambient backdrop-blur-[24px]">
          {statusMessage}
        </div>
      </section>

      <GraphInspector
        graph={graph}
        node={selectedNode}
        onOpen={() => openSelectedNode(selectedNode)}
        onSelect={selectNode}
      />
    </div>
  );
}

function GraphInspector({
  graph,
  node,
  onOpen,
  onSelect,
}: {
  graph: NoteGraph | null;
  node: NoteGraphNode | null;
  onOpen: () => void;
  onSelect: (id: VFSNodeId) => void;
}) {
  const strings = useMessages();

  return (
    <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto bg-surface px-6 py-7">
      {!node ? (
        <p className="text-sm text-text-muted">
          {strings.graph.emptySelection}
        </p>
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
            className="flex h-9 items-center justify-center gap-2 rounded-xl bg-accent-dark px-3 text-sm text-text-on-dark transition-colors hover:bg-accent-dark/90"
          >
            <ExternalLink className="size-3.5" />
            {strings.graph.openNote}
          </button>
          <GraphEdgeList
            title={strings.graph.outgoing}
            emptyText={strings.common.none}
            edges={node.outgoingEdges}
            graph={graph}
            endpoint="target"
            onSelect={onSelect}
          />
          <GraphEdgeList
            title={strings.graph.backlinks}
            emptyText={strings.common.none}
            edges={node.incomingEdges}
            graph={graph}
            endpoint="source"
            onSelect={onSelect}
          />
        </>
      )}
    </aside>
  );
}

function GraphEdgeList({
  title,
  emptyText,
  edges,
  graph,
  endpoint,
  onSelect,
}: {
  title: string;
  emptyText: string;
  edges: NoteGraphEdge[];
  graph: NoteGraph | null;
  endpoint: 'source' | 'target';
  onSelect: (id: VFSNodeId) => void;
}) {
  return (
    <section className="min-h-0">
      <h3 className="font-medium text-[11px] text-text-muted uppercase tracking-[0.08em]">
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-2">
        {edges.length === 0 ? (
          <div className="rounded-lg bg-card px-3 py-2 text-sm text-text-muted">
            {emptyText}
          </div>
        ) : (
          edges.map((edge) => {
            const nodeId =
              endpoint === 'source' ? edge.sourceId : edge.targetId;
            const label = graph?.nodesById.get(nodeId)?.name ?? nodeId;
            return (
              <button
                key={edge.id}
                type="button"
                onClick={() => onSelect(nodeId)}
                className="rounded-lg bg-card px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-hover-tint hover:text-text-primary"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{label}</span>
                  {edge.count > 1 && (
                    <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] text-text-muted tabular-nums">
                      {edge.count}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
