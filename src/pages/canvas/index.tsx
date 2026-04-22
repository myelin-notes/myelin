import { useCallback, useEffect, useRef, useState } from 'react';
import { X as XIcon } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useParams } from 'react-router-dom';
import { WheelPicker, type WheelPickerHandle } from '@/components/wheel-picker';
import { IS_DEV } from '@/lib/env';
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
import type { ChromeMenuItem } from './chrome-menu';
import { setChromeMenuOpener } from './chrome-menu';
import { CanvasToolbar } from './components/canvas-toolbar';
import { ChromeMenu } from './components/chrome-menu';
import { EmbedComposer } from './components/embed-composer';
import { InsertPopover } from './components/insert-popover';
import { PeerSyncPanel } from './components/peer-sync-panel';
import { StatusBar } from './components/status-bar';
import { TitleBar } from './components/title-bar';
import { useCanvasEngine } from './hooks/use-canvas-engine';
import { useToolState } from './hooks/use-tool-state';
import { PageFrameDomLayer } from './page-frame/dom-layer';

export function CanvasView() {
  const { id } = useParams<{ id: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<WheelPickerHandle>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const domOverlayRef = useRef<HTMLDivElement>(null);
  const toolState = useToolState(drawableCanvasRef);

  const [chromeMenu, setChromeMenu] = useState<{
    anchor: DOMRect;
    items: ChromeMenuItem[];
  } | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedAnchor, setEmbedAnchor] = useState<{
    screenX: number;
    screenY: number;
  } | null>(null);
  const [contextInsert, setContextInsert] = useState<{
    screenX: number;
    screenY: number;
    worldPos: Vector2;
  } | null>(null);

  const placeFrameAt = useCallback((worldPos: Vector2) => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    const frame = dc.addElement((i) => new PageFrameElement(i));
    frame.setOffset(worldPos.x, worldPos.y);
    frame.updateBounds();
    dc.updateBounding();
    frame.select();
  }, []);

  const handleInsertFrame = useCallback(() => {
    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    setInsertOpen(false);
    setEmbedOpen(false);
    dc.startPlacement({
      getBounds: () => ({
        x: -CHROME_SIDE_PADDING,
        y: -CHROME_HEADER_HEIGHT,
        width: PAGE_WIDTH + CHROME_SIDE_PADDING * 2,
        height: PAGE_HEIGHT + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
      }),
      onPlace: placeFrameAt,
    });
  }, [placeFrameAt]);

  const handleInsertEmbed = useCallback(() => {
    setInsertOpen(false);
    drawableCanvasRef.current?.cancelPlacement();
    setEmbedAnchor(null);
    setEmbedOpen(true);
  }, []);

  const handleContextInsertFrame = useCallback(() => {
    if (!contextInsert) {
      return;
    }
    placeFrameAt(contextInsert.worldPos);
    setContextInsert(null);
  }, [contextInsert, placeFrameAt]);

  const handleContextInsertEmbed = useCallback(() => {
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

  const handleCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        return;
      }
      const activeTool = toolState.canvasTools[toolState.selectedToolIndex];
      if (activeTool?.id !== 'select') {
        return;
      }
      if (dc.editingElement || dc.isPlacing) {
        return;
      }
      const worldPos = dc.viewport.screenToWorld({ x: e.clientX, y: e.clientY });
      // Only fire on truly empty canvas — don't steal dblclick from elements
      const hit = dc.elements.some((el) =>
        el.isOver(worldPos.x, worldPos.y, 0, dc.ctx),
      );
      if (hit) {
        return;
      }
      setInsertOpen(false);
      setEmbedOpen(false);
      setContextInsert({
        screenX: e.clientX,
        screenY: e.clientY,
        worldPos,
      });
    },
    [toolState.canvasTools, toolState.selectedToolIndex],
  );

  useEffect(() => {
    setChromeMenuOpener((anchor, items) => setChromeMenu({ anchor, items }));
    return () => setChromeMenuOpener(() => {});
  }, []);
  const engine = useCanvasEngine({
    id,
    canvasRef,
    bgCanvasRef,
    overlayCanvasRef,
    domOverlayRef,
    wheelRef,
    drawableCanvasRef,
    canvasTools: toolState.canvasTools,
    setSelectedToolIndex: toolState.setSelectedToolIndex,
    onCanvasPointerDown: toolState.hideOptions,
    onInsertFrame: handleInsertFrame,
    onInsertEmbed: handleInsertEmbed,
  });

  return (
    <div className="relative h-full w-full overflow-hidden bg-page">
      {/* Background canvas: dot grid */}
      <canvas
        ref={bgCanvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ zIndex: 0 }}
      />

      {/* DOM layer: page chrome + PM editor text */}
      <PageFrameDomLayer
        canvasRef={engine.drawableCanvasRef}
        editingElement={engine.editingElement}
      />

      {/* Element-owned DOM overlay (PDF pages, future DOM-rendered elements) */}
      <div
        ref={domOverlayRef}
        id="dom-overlay"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 5 }}
      />

      {/* Foreground canvas: strokes, images, element content (z-index toggled by DrawableCanvas during edit) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        onDoubleClick={handleCanvasDoubleClick}
      />

      {/* Selection overlay canvas: outline + handles. Always above DOM chrome
          so selection stays visible while editing a page-frame/PDF. */}
      <canvas
        ref={overlayCanvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        style={{ zIndex: 12 }}
      />

      {/* Frame chrome controls (hamburger buttons). Sits above the foreground
          canvas so clicks reach the buttons first. Pointer-events-none by
          default; individual buttons opt in. */}
      <div
        id="canvas-chrome-controls"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 100 }}
      />

      <StatusBar zoomLevel={engine.zoomLevel} fps={engine.fps} />
      {IS_DEV && <PeerSyncPanel session={engine.noteSession} />}
      <TitleBar fileName={engine.fileName} onBack={engine.back} />

      <CanvasToolbar
        tools={toolState.canvasTools}
        selectedToolIndex={toolState.selectedToolIndex}
        optionsVisible={toolState.optionsVisible}
        shelfOpen={toolState.shelfOpen}
        insertOpen={insertOpen}
        activeOptions={toolState.activeOptions}
        hasOptions={toolState.hasOptions}
        wheelEnabledIndices={toolState.wheelEnabledIndices}
        onSelectTool={toolState.selectTool}
        onToggleOptions={toolState.toggleOptions}
        onToggleShelf={toolState.toggleShelf}
        onCloseShelf={toolState.closeShelf}
        onToggleInsert={() =>
          setInsertOpen((v) => {
            const next = !v;
            if (next) {
              setEmbedOpen(false);
              setContextInsert(null);
              drawableCanvasRef.current?.cancelPlacement();
            }
            return next;
          })
        }
        onToggleWheelTool={toolState.handleToggleWheelTool}
        insertPopover={
          <InsertPopover
            onInsertFrame={handleInsertFrame}
            onInsertEmbed={handleInsertEmbed}
            onClose={() => setInsertOpen(false)}
          />
        }
        embedComposer={
          <AnimatePresence>
            {embedOpen && (
              <EmbedComposer
                key="embed-composer"
                onEmbedFiles={(files) => {
                  engine.embedFiles(
                    files,
                    embedAnchor?.screenX,
                    embedAnchor?.screenY,
                  );
                  setEmbedOpen(false);
                  setEmbedAnchor(null);
                }}
                onClose={() => {
                  setEmbedOpen(false);
                  setEmbedAnchor(null);
                }}
              />
            )}
          </AnimatePresence>
        }
      />

      <AnimatePresence>
        {contextInsert && (
          <div
            key="context-insert"
            className="pointer-events-auto absolute z-20"
            style={{
              left: contextInsert.screenX,
              top: contextInsert.screenY,
            }}
          >
            <InsertPopover
              onInsertFrame={handleContextInsertFrame}
              onInsertEmbed={handleContextInsertEmbed}
              onClose={() => setContextInsert(null)}
            />
          </div>
        )}
      </AnimatePresence>

      <div
        style={{ zIndex: 100 }}
        className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto"
      >
        <WheelPicker ref={wheelRef} radius={100} items={toolState.wheelItems}>
          <XIcon className="size-4 text-white" />
        </WheelPicker>
      </div>

      <AnimatePresence>
        {chromeMenu && (
          <ChromeMenu
            key="chrome-menu"
            anchor={chromeMenu.anchor}
            items={chromeMenu.items}
            onClose={() => setChromeMenu(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
