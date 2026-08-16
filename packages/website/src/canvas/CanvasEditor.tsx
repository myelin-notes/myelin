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
import {
  CommandPalette,
  type PaletteCommand,
} from '@/components/command-palette';
import { SceneRail, ScrollHint } from '@/components/scene-rail';
import { SelectionToolbar } from '@/components/selection-toolbar';
import { SiteCopyProvider, useCopy } from '@/content/copy-context';
import { useFakeScroll } from '@/hooks/use-fake-scroll';
import { useToolState } from '@/hooks/use-tool-state';
import { CustomColorsProvider } from '@/lib/custom-colors';
import type { Locale } from '@/lib/locale';
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
  canvas.viewport.setViewToFitRect(toDomRect(rect), SCENE_FIT);
}

/**
 * The landing experience: the real Myelin canvas engine mounted on an
 * in-memory Y.Doc, pre-populated with the whole content plan as canvas
 * elements laid out in world space. A fake scroll (wheel/keys/rail, no real
 * scrollbar) steps through preset scenes, and the engine's own view animation
 * flies the camera between them. Visitors can still draw, select, and type
 * on everything.
 */
export default function CanvasEditor({ locale }: { locale: Locale }) {
  // The locale is pinned from the URL: the site prerenders one page per
  // language, so a `language` preference left by the app must not override it.
  return (
    <I18nProvider locale={locale}>
      <SiteCopyProvider locale={locale}>
        <CustomColorsProvider>
          <CanvasEditorInner />
        </CustomColorsProvider>
      </SiteCopyProvider>
    </I18nProvider>
  );
}

function CanvasEditorInner() {
  const copy = useCopy();
  const bgRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  // Once the visitor scrolls/navigates they own the camera; until then we keep
  // re-framing the hero as the canvas settles to its real size (see below).
  const userNavigatedRef = useRef(false);
  const toolState = useToolState(drawableCanvasRef);
  const [canvas, setCanvas] = useState<DrawableCanvas | null>(null);
  const [editingElement, setEditingElement] = useState<DrawableElement | null>(
    null,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

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
    canvas.setBackgroundHost(bg);
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
    void populateScenes(canvas, copy)
      .then(() => {
        if (!disposed) {
          ydoc.undoManager.clear();
        }
      })
      .catch((error) => {
        console.error('Failed to build landing scenes', error);
      });
    // Land on the hero without an animation. The camera must be framed against
    // the canvas's real laid-out size, but on first paint that size is not
    // settled: the element mounts smaller than its final pane and the
    // renderer's own ResizeObserver grows it a beat later. Framing once against
    // that stale size leaves the hero off-center, so re-frame on every resize
    // until the visitor first navigates and takes the camera over. Our observer
    // is created after the renderer's, so its size sync runs first each tick.
    userNavigatedRef.current = false;
    const frameHero = () => {
      if (!userNavigatedRef.current) {
        jumpToScene(canvas, SCENES[0].rect);
      }
    };
    const heroFramer = new ResizeObserver(frameHero);
    heroFramer.observe(fg);

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
      heroFramer.disconnect();
      document.fonts.removeEventListener('loadingdone', handleFontsLoaded);
      fg.removeEventListener('pointerdown', handlePointerDown);
      stopLoop();
      canvas.destroy();
      drawableCanvasRef.current = null;
      setCanvas(null);
      setEditingElement(null);
    };
  }, [canvasTools, setSelectedToolIndex, hideOptions, copy]);

  const { index, goTo } = useFakeScroll({
    sceneCount: SCENES.length,
    isBlocked: () => {
      const c = drawableCanvasRef.current;
      // While an element is being edited the engine owns the wheel (page
      // frames scroll along their page axis).
      return !c || c.editingElement !== null;
    },
    onIndexChange: (i) => {
      userNavigatedRef.current = true;
      drawableCanvasRef.current?.viewport.animateViewToFitRect(
        toDomRect(SCENES[i].rect),
        SCENE_FIT,
      );
    },
  });

  // Cmd/Ctrl+P toggles the palette. The fake scroll ignores modified keys, so
  // this can't collide with scene stepping. preventDefault is load-bearing
  // here: it suppresses the browser's Print dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // The topbar is static Astro markup outside this island, so its Download
  // link is wired here: the canvas is the whole page, so there is no anchor to
  // follow, only a scene to fly to.
  useEffect(() => {
    const link = document.querySelector('[data-download-platform-jump]');
    if (!link) {
      return;
    }
    const handleClick = (event: Event) => {
      event.preventDefault();
      goTo(SCENES.length - 1);
    };
    link.addEventListener('click', handleClick);
    return () => link.removeEventListener('click', handleClick);
  }, [goTo]);

  const paletteCommands: PaletteCommand[] = [
    {
      id: 'download',
      group: 'getIt' as const,
      label: copy.canvas.palette.download,
      run: () => goTo(SCENES.length - 1),
    },
    ...SCENES.map((scene, i) => ({
      id: `scene-${scene.id}`,
      group: 'goTo' as const,
      label: copy.sceneLabels[scene.id],
      run: () => goTo(i),
    })),
  ];

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
        <div ref={bgRef} style={{ zIndex: 0 }} />

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

      <CommandPalette
        open={paletteOpen}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
