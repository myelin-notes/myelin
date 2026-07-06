import { useEffect, useRef, useState } from 'react';
import { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { startDrawableCanvasAnimationLoop } from '@/pages/canvas/hooks/use-drawable-canvas-view-state';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import { regions } from '../content/site';
import { ScrollCamera } from './camera';
import { CommandPalette, type PaletteCommand } from './chrome/CommandPalette';
import { ProgressRail } from './chrome/ProgressRail';
import { TitleBar } from './chrome/TitleBar';
import { ToolShelf } from './chrome/ToolShelf';
import { WorldLayer } from './chrome/WorldLayer';
import { type DomAnchor, seedCanvas } from './seed';

const layerClass = 'absolute inset-0 h-full w-full';

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  );
}

/**
 * The landing experience: the real Myelin canvas engine mounted on an
 * in-memory Y.Doc, seeded with the authored notebook from content/site.ts,
 * with scroll driving the camera along the region path.
 */
export default function CanvasExperience() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<ScrollCamera | null>(null);

  const [dc, setDc] = useState<DrawableCanvas | null>(null);
  const [anchors, setAnchors] = useState<DomAnchor[]>([]);
  const [ready, setReady] = useState(false);
  const [activeRegion, setActiveRegion] = useState(0);
  const [activeTool, setActiveTool] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteOpenRef = useRef(false);
  paletteOpenRef.current = paletteOpen;

  useEffect(() => {
    const container = containerRef.current;
    const fg = fgRef.current;
    const bg = bgRef.current;
    const overlay = overlayRef.current;
    const domHost = domHostRef.current;
    if (!container || !fg || !bg || !overlay || !domHost) {
      return;
    }

    // Start the tour at the top so the cinematic intro plays on load rather
    // than dropping the visitor wherever the browser restored the scroll.
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);

    const canvas = new DrawableCanvas(fg, new YDocManager());
    canvas.setBackgroundCanvas(bg);
    canvas.setOverlayCanvas(overlay);
    canvas.setDomOverlayHost(domHost);
    const stopLoop = startDrawableCanvasAnimationLoop(canvas, () => {});
    canvas.viewport.setOnZoomChange((zoom) => {
      setZoomLevel(Math.round(zoom * 100));
    });

    const camera = new ScrollCamera(
      canvas,
      fg,
      regions.map((region) => region.frame),
    );
    camera.onRegionChange = setActiveRegion;
    cameraRef.current = camera;
    if (import.meta.env.DEV || import.meta.env.PUBLIC_CANVAS_DEBUG) {
      (window as unknown as Record<string, unknown>).__myelinCanvas = canvas;
      (window as unknown as Record<string, unknown>).__myelinCamera = camera;
    }

    let cancelled = false;
    seedCanvas(canvas, regions).then((seededAnchors) => {
      if (cancelled) {
        return;
      }
      setAnchors(seededAnchors);
      camera.start();
      setReady(true);
      document.documentElement.dataset.canvas = 'on';
    });

    // Plain wheel belongs to the page (scroll drives the camera); pinch and
    // ctrl+wheel still reach the viewport so visitors can zoom the canvas.
    // While an element is edited, freeze both so the overlay stays put.
    const handleWheel = (event: WheelEvent) => {
      if (canvas.editingElement) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!event.ctrlKey) {
        event.stopPropagation();
      }
    };
    container.addEventListener('wheel', handleWheel, {
      capture: true,
      passive: false,
    });

    setDc(canvas);

    return () => {
      cancelled = true;
      container.removeEventListener('wheel', handleWheel, { capture: true });
      camera.destroy();
      cameraRef.current = null;
      stopLoop();
      canvas.destroy();
      delete document.documentElement.dataset.canvas;
    };
  }, []);

  useEffect(() => {
    if (!dc) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (paletteOpenRef.current || isTypingTarget(event.target)) {
        return;
      }
      if (dc.editingElement) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          dc.redo();
        } else {
          dc.undo();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dc.redo();
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (
        digit >= 1 &&
        digit <= dc.tools.length &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        dc.switchTool(digit - 1);
        setActiveTool(digit - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dc]);

  const scrollToRegion = (index: number) => {
    const camera = cameraRef.current;
    if (!camera) {
      return;
    }
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    window.scrollTo({
      top: camera.scrollTopForRegion(index),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  };

  const paletteCommands: PaletteCommand[] = [
    ...regions.map((region, index) => ({
      id: `region-${region.id}`,
      group: 'Go to' as const,
      label: region.label,
      run: () => scrollToRegion(index),
    })),
    {
      id: 'download',
      group: 'Get it',
      label: 'Download Myelin Notes',
      run: () => scrollToRegion(regions.length - 1),
    },
    {
      id: 'schema',
      group: 'Pages',
      label: 'Workspace file format',
      run: () => {
        window.location.href = '/workspace-schema';
      },
    },
  ];

  const selectTool = (index: number) => {
    dc?.switchTool(index);
    setActiveTool(index);
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`canvas-stage fixed inset-0 touch-none overflow-hidden transition-opacity duration-700 ${
          ready ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <canvas ref={bgRef} className={layerClass} style={{ zIndex: 0 }} />
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
        {dc && <WorldLayer dc={dc} anchors={anchors} />}
      </div>

      {ready && dc && (
        <>
          <TitleBar
            regionLabel={regions[activeRegion]?.label ?? ''}
            zoomLevel={zoomLevel}
            onOpenPalette={() => setPaletteOpen(true)}
            onDownload={() => scrollToRegion(regions.length - 1)}
          />
          <ToolShelf
            tools={dc.tools}
            activeIndex={activeTool}
            onSelect={selectTool}
            onUndo={() => dc.undo()}
            onRedo={() => dc.redo()}
          />
          <ProgressRail
            labels={regions.map((region) => region.label)}
            activeIndex={activeRegion}
            onJump={scrollToRegion}
          />
          <CommandPalette
            open={paletteOpen}
            commands={paletteCommands}
            onClose={() => setPaletteOpen(false)}
          />
        </>
      )}
    </>
  );
}
