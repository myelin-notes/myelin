import { useEffect, useState } from 'react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { DrawableElement } from '@myelin/editor/elements/drawable-element';

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

export function startDrawableCanvasAnimationLoop(
  drawableCanvas: Pick<DrawableCanvas, 'redraw'>,
  onFps: (fps: number) => void,
): () => void {
  let previousTime = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let frameId = 0;
  let stopped = false;

  function animate(time: number) {
    if (stopped) {
      return;
    }

    const dt = (time - previousTime) / 1000;
    previousTime = time;
    drawableCanvas.redraw(dt);
    if (stopped) {
      return;
    }

    if (dt > 0) {
      fpsAccum += dt;
      fpsFrames += 1;
      if (fpsAccum >= 0.5) {
        const fps = Math.round(fpsFrames / fpsAccum);
        fpsAccum = 0;
        fpsFrames = 0;
        onFps(fps);
        if (stopped) {
          return;
        }
      }
    }

    frameId = requestAnimationFrame(animate);
  }

  frameId = requestAnimationFrame(animate);
  return () => {
    stopped = true;
    cancelAnimationFrame(frameId);
  };
}

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
      setViewState((current) => ({
        ...current,
        zoomLevel: Math.round(zoom * 100),
      }));
    });
    canvas.setOnElementEdit((editingElement) => {
      setViewState((current) => ({
        ...current,
        editingElement,
      }));
    });
    const stopAnimation = startDrawableCanvasAnimationLoop(canvas, (fps) => {
      setViewState((current) => ({
        ...current,
        fps,
      }));
    });

    return () => {
      stopAnimation();
      canvas.viewport.setOnZoomChange(() => {});
      canvas.setOnElementEdit(() => {});
    };
  }, [drawableCanvas]);

  return viewState;
}
