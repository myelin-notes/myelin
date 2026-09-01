import { type RefObject, useCallback, useRef, useState } from 'react';
import type { DrawableCanvas, Vector2 } from '@myelin/editor/drawable-canvas';
import {
  AUDIO_NATURAL_HEIGHT,
  AUDIO_NATURAL_WIDTH,
  AudioElement,
} from '@myelin/editor/elements/audio/element';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
} from '@myelin/editor/elements/frame/chrome';
import { LatexElement } from '@myelin/editor/elements/latex/element';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PageFrameElement,
} from '@myelin/editor/elements/page-frame-element';
import type { ITool } from '@myelin/editor/tools/tool';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { CollisionHelper } from '@myelin/editor/utils/collision-helper';
import { trackEvent } from '@/lib/analytics';

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

// iOS won't open the picker for a detached input, so mount it for the duration.
function capturePhoto(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;
    const finish = () => {
      input.remove();
      resolve(input.files?.[0] ?? null);
    };
    input.addEventListener('change', finish, { once: true });
    input.addEventListener('cancel', finish, { once: true });
    document.body.append(input);
    input.click();
  });
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
      const frame = dc.addElement(
        (uuid) =>
          new PageFrameElement(
            uuid,
            undefined,
            UserPrefs.get('defaultPageLayout'),
          ),
      );
      frame.setOffset(worldPos.x, worldPos.y);
      frame.updateBounds();
      frame.select();
      trackEvent('page_frame_created', {
        insertion_method: 'menu',
        layout: UserPrefs.get('defaultPageLayout'),
      });
    },
    [drawableCanvasRef],
  );

  const placeAudioAt = useCallback(
    (worldPos: Vector2) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      const el = dc.addElement((uuid) => {
        const audio = new AudioElement(uuid, dc.localPeerId);
        audio.setOffset(worldPos.x, worldPos.y);
        return audio;
      });
      el.updateBounds();
      el.select();
      trackEvent('element_inserted', {
        element_type: 'audio',
        insertion_method: 'menu',
      });
    },
    [drawableCanvasRef],
  );

  const placeLatexAt = useCallback(
    (worldPos: Vector2) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      const latex = dc.addElement((uuid) => {
        const el = new LatexElement(uuid);
        el.setOffset(worldPos.x, worldPos.y);
        return el;
      });
      latex.updateBounds();
      latex.select();
      trackEvent('element_inserted', {
        element_type: 'latex',
        insertion_method: 'menu',
      });
      // Placement runs inside a canvas pointerdown; entering edit now would
      // register a click-outside listener that the same event, still bubbling
      // to document, immediately trips. Defer past this event.
      requestAnimationFrame(() => dc.enterElementEdit(latex));
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

  const onInsertLatex = useCallback(() => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    setInsertOpen(false);
    setEmbedOpen(false);
    setContextInsert(null);
    dc.startPlacement({
      getBounds: () => ({ x: 0, y: 0, width: 140, height: 44 }),
      onPlace: placeLatexAt,
    });
  }, [drawableCanvasRef, placeLatexAt]);

  const onInsertAudio = useCallback(() => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    setInsertOpen(false);
    setEmbedOpen(false);
    setContextInsert(null);
    dc.startPlacement({
      getBounds: () => ({
        x: 0,
        y: 0,
        width: AUDIO_NATURAL_WIDTH,
        height: AUDIO_NATURAL_HEIGHT,
      }),
      onPlace: placeAudioAt,
    });
  }, [drawableCanvasRef, placeAudioAt]);

  const onInsertEmbed = useCallback(() => {
    setInsertOpen(false);
    setContextInsert(null);
    drawableCanvasRef.current?.cancelPlacement();
    setEmbedAnchor(null);
    setEmbedOpen(true);
  }, [drawableCanvasRef]);

  const onInsertCamera = useCallback(() => {
    setInsertOpen(false);
    setContextInsert(null);
    drawableCanvasRef.current?.cancelPlacement();
    void capturePhoto().then((file) => {
      if (file) {
        embedFiles([file]);
      }
    });
  }, [drawableCanvasRef, embedFiles]);

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

  const onContextInsertLatex = useCallback(() => {
    if (!contextInsert) {
      return;
    }
    placeLatexAt(contextInsert.worldPos);
    setContextInsert(null);
  }, [contextInsert, placeLatexAt]);

  const onContextInsertAudio = useCallback(() => {
    if (!contextInsert) {
      return;
    }
    placeAudioAt(contextInsert.worldPos);
    setContextInsert(null);
  }, [contextInsert, placeAudioAt]);

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

  const onContextInsertCamera = useCallback(() => {
    if (!contextInsert) {
      return;
    }
    const { screenX, screenY } = contextInsert;
    setContextInsert(null);
    void capturePhoto().then((file) => {
      if (file) {
        embedFiles([file], screenX, screenY);
      }
    });
  }, [contextInsert, embedFiles]);

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
      const screenPos = dc.viewport.getScreenPoint(e);
      const worldPos = dc.viewport.screenToWorld(screenPos);
      const hit = dc.elements.some(
        (el) => !el.hidden && CollisionHelper.inBox(worldPos, el.boundingBox),
      );
      if (hit) {
        lastClickRef.current = null;
        return;
      }
      const now = performance.now();
      const prev = lastClickRef.current;
      lastClickRef.current = { t: now, x: screenPos.x, y: screenPos.y };
      if (
        !prev ||
        now - prev.t > 250 ||
        Math.hypot(screenPos.x - prev.x, screenPos.y - prev.y) > 4
      ) {
        return;
      }
      lastClickRef.current = null;
      setInsertOpen(false);
      setEmbedOpen(false);
      setContextInsert({
        screenX: screenPos.x,
        screenY: screenPos.y,
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
    onInsertLatex,
    onInsertAudio,
    onInsertCamera,
    onContextInsertFrame,
    onContextInsertEmbed,
    onContextInsertLatex,
    onContextInsertAudio,
    onContextInsertCamera,
    onCanvasClick,
    submitEmbed,
    closeEmbed,
  };
}
