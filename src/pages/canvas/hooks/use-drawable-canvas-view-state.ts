import { useEffect, useState } from 'react';
import {
  canvasPerfSummary,
  formatCanvasPerf,
  isCanvasPerfEnabled,
} from '@myelin/editor/canvas-perf';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { DrawableElement } from '@myelin/editor/elements/drawable-element';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';
import { IS_DEV, IS_TABLET_BUILD } from '@/lib/env';

// Where the status bar actually shows the FPS readout. Tablet builds are
// included while we chase the iPad frame rate: without it there is no way to
// turn "feels slow" into a number on a sideloaded device, which cannot be
// attached to Safari Web Inspector.
const SHOW_FPS = IS_DEV || IS_TABLET_BUILD;

interface DrawableCanvasViewState {
  zoomLevel: number;
  fps: number;
  /** Frame-time breakdown, empty when perf sampling is off. */
  perf: string;
  editingElement: DrawableElement | null;
}

const EMPTY_VIEW_STATE: DrawableCanvasViewState = {
  zoomLevel: 100,
  fps: 0,
  perf: '',
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
      perf: '',
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
      // Only thread fps into React state where StatusBar actually renders it;
      // elsewhere this would reconcile the whole canvas tree twice a second to
      // update an invisible value.
      if (!SHOW_FPS) {
        return;
      }
      // Piggybacks the fps callback's twice-a-second cadence rather than
      // sampling per frame, so reading the breakdown cannot perturb it.
      const perf = isCanvasPerfEnabled()
        ? formatCanvasPerf(canvasPerfSummary())
        : '';
      setViewState((current) =>
        current.fps === fps && current.perf === perf
          ? current
          : { ...current, fps, perf },
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
