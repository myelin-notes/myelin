import { type RefObject, useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
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
import { useMessages } from '@myelin/editor/i18n';
import type { ITool } from '@myelin/editor/tools/tool';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { CollisionHelper } from '@myelin/editor/utils/collision-helper';
import { trackEvent } from '@/lib/analytics';
import { MOBILE_PLATFORM } from '@/lib/env';
import { prepareCapturedPhoto } from '../photo-capture';

export interface ContextInsertAnchor {
  screenX: number;
  screenY: number;
  worldPos: Vector2;
}

interface EmbedAnchor {
  screenX: number;
  screenY: number;
}

interface CanvasTap {
  t: number;
  x: number;
  y: number;
}

interface PointerTapCandidate {
  pointerId: number;
  x: number;
  y: number;
}

const CANVAS_DOUBLE_TAP_MS = 400;
const CANVAS_DOUBLE_TAP_SLOP_PX = 16;
const CANVAS_TAP_SLOP_PX = 12;

export function isCanvasDoubleTap(
  previous: CanvasTap | null,
  current: CanvasTap,
): boolean {
  return (
    previous !== null &&
    current.t - previous.t <= CANVAS_DOUBLE_TAP_MS &&
    Math.hypot(current.x - previous.x, current.y - previous.y) <=
      CANVAS_DOUBLE_TAP_SLOP_PX
  );
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
  const strings = useMessages();
  const [insertOpen, setInsertOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraFileInputRef = useRef<HTMLInputElement>(null);
  const cameraAnchorRef = useRef<EmbedAnchor | null>(null);
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

  const openCamera = useCallback(
    (anchor: EmbedAnchor | null) => {
      if (!drawableCanvasRef.current) {
        return;
      }
      cameraAnchorRef.current = anchor;
      setInsertOpen(false);
      setContextInsert(null);
      setEmbedOpen(false);
      drawableCanvasRef.current.cancelPlacement();
      if (MOBILE_PLATFORM === 'ios' || MOBILE_PLATFORM === 'android') {
        cameraFileInputRef.current?.click();
      } else {
        setCameraOpen(true);
      }
    },
    [drawableCanvasRef],
  );

  const onTakePhoto = useCallback(() => openCamera(null), [openCamera]);

  const onContextTakePhoto = useCallback(() => {
    if (contextInsert) {
      openCamera({
        screenX: contextInsert.screenX,
        screenY: contextInsert.screenY,
      });
    }
  }, [contextInsert, openCamera]);

  const onCameraCapture = useCallback(
    (file: File) => {
      embedFiles(
        [file],
        cameraAnchorRef.current?.screenX,
        cameraAnchorRef.current?.screenY,
      );
      setCameraOpen(false);
    },
    [embedFiles],
  );

  const onCameraFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (!file) {
        return;
      }
      const anchor = cameraAnchorRef.current;
      void prepareCapturedPhoto(file)
        .then((photo) => embedFiles([photo], anchor?.screenX, anchor?.screenY))
        .catch((cause) => {
          toast.error(strings.canvas.camera.captureFailed, {
            description: cause instanceof Error ? cause.message : String(cause),
          });
        });
    },
    [embedFiles, strings.canvas.camera.captureFailed],
  );

  const closeCamera = useCallback(() => setCameraOpen(false), []);

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

  const lastTapRef = useRef<CanvasTap | null>(null);
  const pointerTapCandidateRef = useRef<PointerTapCandidate | null>(null);
  const activeCanvasPointersRef = useRef(new Set<number>());

  const handleCanvasTap = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
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
      const screenPos = dc.viewport.getScreenPoint(event);
      const worldPos = dc.viewport.screenToWorld(screenPos);
      const hit = dc.elements.some(
        (el) => !el.hidden && CollisionHelper.inBox(worldPos, el.boundingBox),
      );
      if (hit) {
        lastTapRef.current = null;
        return;
      }
      const now = performance.now();
      const prev = lastTapRef.current;
      const current = { t: now, x: screenPos.x, y: screenPos.y };
      lastTapRef.current = current;
      if (!isCanvasDoubleTap(prev, current)) {
        return;
      }
      lastTapRef.current = null;
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

  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const activePointers = activeCanvasPointersRef.current;
      activePointers.add(event.pointerId);
      if (event.button !== 0 || activePointers.size !== 1) {
        pointerTapCandidateRef.current = null;
        lastTapRef.current = null;
        return;
      }
      pointerTapCandidateRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    },
    [],
  );

  const onCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const candidate = pointerTapCandidateRef.current;
      if (
        candidate?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) >
          CANVAS_TAP_SLOP_PX
      ) {
        pointerTapCandidateRef.current = null;
        lastTapRef.current = null;
      }
    },
    [],
  );

  const onCanvasPointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      activeCanvasPointersRef.current.delete(event.pointerId);
      const candidate = pointerTapCandidateRef.current;
      pointerTapCandidateRef.current = null;
      if (
        candidate?.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) >
          CANVAS_TAP_SLOP_PX
      ) {
        lastTapRef.current = null;
        return;
      }
      handleCanvasTap(event);
    },
    [handleCanvasTap],
  );

  const onCanvasPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      activeCanvasPointersRef.current.delete(event.pointerId);
      pointerTapCandidateRef.current = null;
      lastTapRef.current = null;
    },
    [],
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
    cameraOpen,
    cameraFileInputRef,
    contextInsert,
    toggleInsert,
    closeInsert,
    closeContextInsert,
    onInsertFrame,
    onInsertEmbed,
    onInsertLatex,
    onInsertAudio,
    onTakePhoto,
    onContextTakePhoto,
    onCameraCapture,
    onCameraFileChange,
    closeCamera,
    onContextInsertFrame,
    onContextInsertEmbed,
    onContextInsertLatex,
    onContextInsertAudio,
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,
    submitEmbed,
    closeEmbed,
  };
}
