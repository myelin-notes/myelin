import { useEffect, useRef, useState } from 'react';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { I18nProvider } from '@myelin/editor/i18n';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { CanvasToolbar } from '@/components/canvas-toolbar';
import { useToolState } from '@/hooks/use-tool-state';
import { CustomColorsProvider } from '@/lib/custom-colors';

const layerClass = 'absolute inset-0 h-full w-full';

/**
 * The landing experience: the real Myelin canvas engine mounted on an
 * in-memory Y.Doc, taking the full viewport, with the app's tool rail wired to
 * it. Visitors draw, highlight, erase, select, and type directly on the page.
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
  const [ready, setReady] = useState(false);

  const { canvasTools, setSelectedToolIndex, hideOptions } = toolState;

  useEffect(() => {
    const fg = fgRef.current;
    const bg = bgRef.current;
    const overlay = overlayRef.current;
    const domHost = domHostRef.current;
    if (!fg || !bg || !overlay || !domHost) {
      return;
    }

    const canvas = new DrawableCanvas(fg, new YDocManager(), canvasTools);
    canvas.setBackgroundCanvas(bg);
    canvas.setOverlayCanvas(overlay);
    canvas.setDomOverlayHost(domHost);
    canvas.setOnToolSwitched(setSelectedToolIndex);
    drawableCanvasRef.current = canvas;

    // Dismiss the tool-options panel as soon as the user starts interacting
    // with the canvas, matching the app.
    const handlePointerDown = () => hideOptions();
    fg.addEventListener('pointerdown', handlePointerDown);

    const stopLoop = startDrawableCanvasAnimationLoop(canvas, () => {});
    setReady(true);

    return () => {
      fg.removeEventListener('pointerdown', handlePointerDown);
      stopLoop();
      canvas.destroy();
      drawableCanvasRef.current = null;
    };
  }, [canvasTools, setSelectedToolIndex, hideOptions]);

  return (
    <div className="fixed inset-0 touch-none overflow-hidden bg-page">
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

      {ready && (
        <CanvasToolbar
          tools={toolState.canvasTools}
          selectedToolIndex={toolState.selectedToolIndex}
          optionsVisible={toolState.optionsVisible}
          activeOptions={toolState.activeOptions}
          hasOptions={toolState.hasOptions}
          onSelectTool={toolState.selectTool}
          onToggleOptions={toolState.toggleOptions}
        />
      )}
    </div>
  );
}
