import { useEffect, useEffectEvent, useRef, useState } from 'react';
// KaTeX styles for math in page frames; the app imports this in its root CSS
// (src/index.css), so the editor's own styles.css does not carry it. Without
// it the MathML fallback renders as duplicate plain text under each formula.
import 'katex/dist/katex.min.css';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { DrawableElement } from '@myelin/editor/elements/drawable-element';
import { I18nProvider } from '@myelin/editor/i18n';
import { PageFrameDomLayer } from '@myelin/editor/page-frame/dom-layer';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { CanvasToolbar } from '@/components/canvas-toolbar';
import { SceneRail, ScrollHint } from '@/components/scene-rail';
import { SelectionToolbar } from '@/components/selection-toolbar';
import { useFakeScroll } from '@/hooks/use-fake-scroll';
import { useToolState } from '@/hooks/use-tool-state';
import { CustomColorsProvider } from '@/lib/custom-colors';
import { initWebPlatform } from '@/lib/web-platform';
import { SceneOverlay, SceneUnderlay } from './scene-overlays';
import { populateScenes, SCENES, type WorldRect } from './scenes';

const layerClass = 'absolute inset-0 h-full w-full';

/** How much of the viewport a scene should fill once the camera lands. */
const SCENE_FIT = { widthRatio: 0.88, heightRatio: 0.85 };

function toDomRect(rect: WorldRect): DOMRect {
  return new DOMRect(rect.x, rect.y, rect.width, rect.height);
}

/** Place the camera on a scene instantly (no animation), for the first paint. */
function jumpToScene(canvas: DrawableCanvas, rect: WorldRect): void {
  const viewport = canvas.viewport;
  viewport.cancelAnimation();
  const world = viewport.getWorldRect();
  const screenW = world.width * viewport.zoom;
  const screenH = world.height * viewport.zoom;
  if (screenW < 1 || screenH < 1) {
    return;
  }
  const targetZoom = Math.min(
    3,
    Math.max(
      0.2,
      Math.min(
        (SCENE_FIT.widthRatio * screenW) / rect.width,
        (SCENE_FIT.heightRatio * screenH) / rect.height,
      ),
    ),
  );
  viewport.zoomByFactor(targetZoom / viewport.zoom);
  const after = viewport.getWorldRect();
  viewport.panBy(
    after.x + after.width / 2 - (rect.x + rect.width / 2),
    after.y + after.height / 2 - (rect.y + rect.height / 2),
  );
}

/**
 * The landing experience: the real Myelin canvas engine mounted on an
 * in-memory Y.Doc, pre-populated with the whole content plan as canvas
 * elements laid out in world space. A fake scroll (wheel/keys/rail, no real
 * scrollbar) steps through preset scenes, and the engine's own view animation
 * flies the camera between them. Visitors can still draw, select, and type
 * on everything.
 */
export default function CanvasEditor() {
  return (
    <I18nProvider>
      <CustomColorsProvider>
        <CanvasEditorInner />
      </CustomColorsProvider>
    </I18nProvider>
  );
}

function CanvasEditorInner() {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const toolState = useToolState(drawableCanvasRef);
  const [canvas, setCanvas] = useState<DrawableCanvas | null>(null);
  const [editingElement, setEditingElement] = useState<DrawableElement | null>(
    null,
  );

  const { canvasTools, setSelectedToolIndex, hideOptions } = toolState;

  useEffect(() => {
    const fg = fgRef.current;
    const bg = bgRef.current;
    const overlay = overlayRef.current;
    const domHost = domHostRef.current;
    if (!fg || !bg || !overlay || !domHost) {
      return;
    }

    initWebPlatform();
    const ydoc = new YDocManager();
    const canvas = new DrawableCanvas(fg, ydoc, canvasTools);
    canvas.setBackgroundCanvas(bg);
    canvas.setOverlayCanvas(overlay);
    canvas.setDomOverlayHost(domHost);
    canvas.setOnToolSwitched(setSelectedToolIndex);
    canvas.setOnElementEdit(setEditingElement);
    drawableCanvasRef.current = canvas;

    // Dismiss the tool-options panel as soon as the user starts interacting
    // with the canvas, matching the app.
    const handlePointerDown = () => hideOptions();
    fg.addEventListener('pointerdown', handlePointerDown);

    const stopLoop = startDrawableCanvasAnimationLoop(canvas, () => {});

    // Seed the whole landing document, then drop it from undo history so a
    // visitor's Ctrl+Z can't erase the site (only their own edits).
    let disposed = false;
    void populateScenes(canvas)
      .then(() => {
        if (!disposed) {
          ydoc.undoManager.clear();
        }
      })
      .catch((error) => {
        console.error('Failed to build landing scenes', error);
      });
    // First paint: land on the hero without an animation. Deferred a frame so
    // the renderer has sized the canvas.
    const introRaf = requestAnimationFrame(() => {
      jumpToScene(canvas, SCENES[0].rect);
    });

    // Text boxes measure their height with fallback metrics until the
    // handwriting font (Caveat) finishes loading; re-measure so nothing stays
    // clipped to the pre-swap line count.
    const handleFontsLoaded = () => {
      for (const element of canvas.elements) {
        element.updateBounds();
      }
    };
    document.fonts.addEventListener('loadingdone', handleFontsLoaded);

    setCanvas(canvas);

    return () => {
      disposed = true;
      cancelAnimationFrame(introRaf);
      document.fonts.removeEventListener('loadingdone', handleFontsLoaded);
      fg.removeEventListener('pointerdown', handlePointerDown);
      stopLoop();
      canvas.destroy();
      drawableCanvasRef.current = null;
      setCanvas(null);
      setEditingElement(null);
    };
  }, [canvasTools, setSelectedToolIndex, hideOptions]);

  const { index, goTo } = useFakeScroll({
    sceneCount: SCENES.length,
    isBlocked: () => {
      const c = drawableCanvasRef.current;
      // While an element is being edited the engine owns the wheel (page
      // frames scroll along their page axis).
      return !c || c.editingElement !== null;
    },
    onIndexChange: (i) => {
      drawableCanvasRef.current?.viewport.animateViewToFitRect(
        toDomRect(SCENES[i].rect),
        SCENE_FIT,
      );
    },
  });

  // Keep the active scene framed across window resizes.
  const refitScene = useEffectEvent(() => {
    drawableCanvasRef.current?.viewport.animateViewToFitRect(
      toDomRect(SCENES[index].rect),
      SCENE_FIT,
    );
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(refitScene, 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="fixed inset-0 touch-none overflow-hidden bg-page">
      {/* Canvas layers live in their own stage. The viewport attaches its
          wheel listener to the foreground canvas's parent and preventDefaults
          scrolling, so the toolbar must be a sibling of this stage (not a
          descendant) or its scrollable menus (e.g. the font picker) can't
          scroll. */}
      <div className="absolute inset-0">
        <canvas ref={bgRef} className={layerClass} style={{ zIndex: 0 }} />

        {/* Mock app surfaces render under the ink so annotations draw on top
            of them. */}
        {canvas && <SceneUnderlay canvas={canvas} />}

        {/* Page-frame chrome + ProseMirror editors (z 5, self-positioned). */}
        {canvas && (
          <PageFrameDomLayer
            canvasRef={drawableCanvasRef}
            editingElement={editingElement}
          />
        )}

        <div
          ref={domHostRef}
          className={`${layerClass} pointer-events-none`}
          style={{ zIndex: 5 }}
        />
        <canvas ref={fgRef} className={layerClass} style={{ zIndex: 10 }} />
        <canvas
          ref={overlayRef}
          className={`${layerClass} pointer-events-none`}
          style={{ zIndex: 12 }}
        />
      </div>

      {/* Page-frame hamburger buttons opt into pointer events individually. */}
      <div
        id="canvas-chrome-controls"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 20 }}
      />

      {/* Interactive CTAs/links anchored in world space, above the canvas. */}
      {canvas && (
        <SceneOverlay canvas={canvas} onSeeItInAction={() => goTo(1)} />
      )}

      {canvas && (
        <div data-canvas-ui>
          <SelectionToolbar drawableCanvasRef={drawableCanvasRef} />
          <CanvasToolbar
            tools={toolState.canvasTools}
            selectedToolIndex={toolState.selectedToolIndex}
            optionsVisible={toolState.optionsVisible}
            activeOptions={toolState.activeOptions}
            hasOptions={toolState.hasOptions}
            onSelectTool={toolState.selectTool}
            onToggleOptions={toolState.toggleOptions}
          />
        </div>
      )}

      <SceneRail scenes={SCENES} index={index} onSelect={goTo} />
      <ScrollHint visible={index === 0} />
    </div>
  );
}
