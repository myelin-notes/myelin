import { useEffect, useState } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { DrawableElement } from '@myelin/editor/elements/drawable-element';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';
import { IS_DEV } from '@/lib/env';

interface DrawableCanvasViewState {
  zoomLevel: number;
  fps: number;
  editingElement: DrawableElement | null;
}

const EMPTY_VIEW_STATE: DrawableCanvasViewState = {
  zoomLevel: 100,
  fps: 0,
  editingElement: null,
};

export function useDrawableCanvasViewState(
  drawableCanvas: DrawableCanvas | null,
): DrawableCanvasViewState {
  const [viewState, setViewState] =
    useState<DrawableCanvasViewState>(EMPTY_VIEW_STATE);

  useEffect(() => {
    if (!drawableCanvas) {
      setViewState(EMPTY_VIEW_STATE);
      return;
    }

    const canvas = drawableCanvas;

    setViewState({
      zoomLevel: Math.round(canvas.viewport.zoom * 100),
      fps: 0,
      editingElement: canvas.editingElement,
    });

    canvas.viewport.setOnZoomChange((zoom) => {
      // Fires on every frame of the zoom animation and every wheel/pinch tick;
      // the rounded percentage is unchanged across most consecutive frames, so
      // reuse the current state reference to skip redundant re-renders.
      setViewState((current) => {
        const zoomLevel = Math.round(zoom * 100);
        return zoomLevel === current.zoomLevel
          ? current
          : { ...current, zoomLevel };
      });
    });
    canvas.setOnElementEdit((editingElement) => {
      setViewState((current) => ({
        ...current,
        editingElement,
      }));
    });
    const stopAnimation = startDrawableCanvasAnimationLoop(canvas, (fps) => {
      // The FPS counter is only rendered in dev (StatusBar gates it behind
      // IS_DEV). In production, threading fps into React state would reconcile
      // the whole canvas tree twice a second to update an invisible value.
      if (!IS_DEV) {
        return;
      }
      setViewState((current) =>
        current.fps === fps ? current : { ...current, fps },
      );
    });

    return () => {
      stopAnimation();
      canvas.viewport.setOnZoomChange(() => {});
      canvas.setOnElementEdit(() => {});
    };
  }, [drawableCanvas]);

  return viewState;
}
