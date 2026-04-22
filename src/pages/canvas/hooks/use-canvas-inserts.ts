import { type RefObject, useCallback, useRef, useState } from 'react';
import type { DrawableCanvas, Vector2 } from '@/pages/canvas/drawable-canvas';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
} from '@/pages/canvas/elements/frame-chrome';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PageFrameElement,
} from '@/pages/canvas/elements/page-frame-element';
import type { ITool } from '@/pages/canvas/tools/tool';

export interface ContextInsertAnchor {
  screenX: number;
  screenY: number;
  worldPos: Vector2;
}

interface EmbedAnchor {
  screenX: number;
  screenY: number;
}

interface UseCanvasInsertsArgs {
  drawableCanvasRef: RefObject<DrawableCanvas | null>;
  canvasTools: ITool[];
  selectedToolIndex: number;
  embedFiles: (
    files: FileList | File[],
    screenX?: number,
    screenY?: number,
  ) => void;
}

export function useCanvasInserts({
  drawableCanvasRef,
  canvasTools,
  selectedToolIndex,
  embedFiles,
}: UseCanvasInsertsArgs) {
  const [insertOpen, setInsertOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedAnchor, setEmbedAnchor] = useState<EmbedAnchor | null>(null);
  const [contextInsert, setContextInsert] =
    useState<ContextInsertAnchor | null>(null);

  const placeFrameAt = useCallback(
    (worldPos: Vector2) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      const frame = dc.addElement((i) => new PageFrameElement(i));
      frame.setOffset(worldPos.x, worldPos.y);
      frame.updateBounds();
      dc.updateBounding();
      frame.select();
    },
    [drawableCanvasRef],
  );

  const onInsertFrame = useCallback(() => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    setInsertOpen(false);
    setEmbedOpen(false);
    setContextInsert(null);
    dc.startPlacement({
      getBounds: () => ({
        x: -CHROME_SIDE_PADDING,
        y: -CHROME_HEADER_HEIGHT,
        width: PAGE_WIDTH + CHROME_SIDE_PADDING * 2,
        height: PAGE_HEIGHT + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
      }),
      onPlace: placeFrameAt,
    });
  }, [drawableCanvasRef, placeFrameAt]);

  const onInsertEmbed = useCallback(() => {
    setInsertOpen(false);
    setContextInsert(null);
    drawableCanvasRef.current?.cancelPlacement();
    setEmbedAnchor(null);
    setEmbedOpen(true);
  }, [drawableCanvasRef]);

  const toggleInsert = useCallback(() => {
    setInsertOpen((v) => {
      const next = !v;
      if (next) {
        setEmbedOpen(false);
        setContextInsert(null);
        drawableCanvasRef.current?.cancelPlacement();
      }
      return next;
    });
  }, [drawableCanvasRef]);

  const closeInsert = useCallback(() => setInsertOpen(false), []);
  const closeContextInsert = useCallback(() => setContextInsert(null), []);

  const onContextInsertFrame = useCallback(() => {
    if (!contextInsert) {
      return;
    }
    placeFrameAt(contextInsert.worldPos);
    setContextInsert(null);
  }, [contextInsert, placeFrameAt]);

  const onContextInsertEmbed = useCallback(() => {
    if (!contextInsert) {
      return;
    }
    setEmbedAnchor({
      screenX: contextInsert.screenX,
      screenY: contextInsert.screenY,
    });
    setContextInsert(null);
    setEmbedOpen(true);
  }, [contextInsert]);

  const lastClickRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      const activeTool = canvasTools[selectedToolIndex];
      if (activeTool?.id !== 'select') {
        return;
      }
      if (dc.editingElement || dc.isPlacing) {
        return;
      }
      const now = performance.now();
      const prev = lastClickRef.current;
      lastClickRef.current = { t: now, x: e.pageX, y: e.pageY };
      if (
        !prev ||
        now - prev.t > 250 ||
        Math.hypot(e.pageX - prev.x, e.pageY - prev.y) > 4
      ) {
        return;
      }
      const worldPos = dc.viewport.screenToWorld({
        x: e.pageX,
        y: e.pageY,
      });
      const hit = dc.elements.some((el) =>
        el.isOver(worldPos.x, worldPos.y, 0, dc.ctx),
      );
      if (hit) {
        return;
      }
      lastClickRef.current = null;
      setInsertOpen(false);
      setEmbedOpen(false);
      setContextInsert({
        screenX: e.pageX,
        screenY: e.pageY,
        worldPos,
      });
    },
    [drawableCanvasRef, canvasTools, selectedToolIndex],
  );

  const submitEmbed = useCallback(
    (files: File[]) => {
      embedFiles(files, embedAnchor?.screenX, embedAnchor?.screenY);
      setEmbedOpen(false);
      setEmbedAnchor(null);
    },
    [embedFiles, embedAnchor],
  );

  const closeEmbed = useCallback(() => {
    setEmbedOpen(false);
    setEmbedAnchor(null);
  }, []);

  return {
    insertOpen,
    embedOpen,
    contextInsert,
    toggleInsert,
    closeInsert,
    closeContextInsert,
    onInsertFrame,
    onInsertEmbed,
    onContextInsertFrame,
    onContextInsertEmbed,
    onCanvasClick,
    submitEmbed,
    closeEmbed,
  };
}
