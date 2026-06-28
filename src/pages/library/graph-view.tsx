import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import type { VFSNodeId } from '@/lib/sync';
import { GraphCanvasController } from '@/pages/graph/graph-canvas-controller';
import type { NoteGraph, NoteGraphNode } from '@/pages/graph/types';

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

function startAnimationLoop(
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

interface GraphViewProps {
  graph: NoteGraph;
  onOpenNode: (node: NoteGraphNode) => void;
}

/**
 * Embeddable force-directed note graph: the canvas + controller wiring from the
 * full-screen GraphPage, without the page chrome or inspector. Recreates its
 * layout (and refits) whenever `graph` changes, so feeding it a scoped subgraph
 * re-animates to the new selection.
 */
export function GraphView({ graph, onOpenNode }: GraphViewProps) {
  const strings = useMessages();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<GraphCanvasController | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selectedId, setSelectedId] = useState<VFSNodeId | null>(null);
  const selectedIdRef = useRef<VFSNodeId | null>(null);

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
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    resizeCanvas();
    const controller = new GraphCanvasController(canvas, graph);
    controllerRef.current = controller;
    controller.setSelectedId(selectedIdRef.current);
    controller.fit();
    const stopAnimation = startAnimationLoop(controller);

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

  const screenPointForEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [],
  );

  return (
    <div className="relative h-full w-full">
      <button
        type="button"
        onClick={() => controllerRef.current?.fit()}
        className="absolute top-3 right-3 z-10 flex h-8 items-center gap-2 rounded-lg bg-card/85 px-2.5 text-sm text-text-secondary shadow-ambient backdrop-blur-[24px] transition-colors hover:bg-card hover:text-text-primary"
      >
        <Maximize2 className="size-3.5" />
        {strings.graph.fit}
      </button>
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
          const rect = event.currentTarget.getBoundingClientRect();
          const hit = controller.hitTest({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
          if (hit) {
            onOpenNode(hit.source);
          }
        }}
      />
    </div>
  );
}
