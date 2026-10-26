import { useEffect, useRef, useState } from 'react';
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
import { SelectionToolbar } from '@/components/selection-toolbar';
import { SiteCopyProvider } from '@/content/copy-context';
import { useToolState } from '@/hooks/use-tool-state';
import { CustomColorsProvider } from '@/lib/custom-colors';
import type { Locale } from '@/lib/locale';
import { initWebPlatform } from '@/lib/web-platform';

const layerClass = 'absolute inset-0 h-full w-full';

/**
 * The try-it page: the real Myelin canvas engine on a blank in-memory Y.Doc,
 * with the app's tool rail. Nothing is persisted; a reload starts over.
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
  const bgRef = useRef<HTMLDivElement>(null);
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
    const canvas = new DrawableCanvas(fg, new YDocManager(), canvasTools);
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
    setCanvas(canvas);

    return () => {
      fg.removeEventListener('pointerdown', handlePointerDown);
      stopLoop();
      canvas.destroy();
      drawableCanvasRef.current = null;
      setCanvas(null);
      setEditingElement(null);
    };
  }, [canvasTools, setSelectedToolIndex, hideOptions]);

  return (
    <div
      data-canvas-root
      className="fixed inset-0 touch-none overflow-hidden bg-page"
    >
      {/* Canvas layers live in their own stage. The viewport attaches its
          wheel listener to the foreground canvas's parent and preventDefaults
          scrolling, so the toolbar must be a sibling of this stage (not a
          descendant) or its scrollable menus (e.g. the font picker) can't
          scroll. */}
      <div className="absolute inset-0">
        <div ref={bgRef} style={{ zIndex: 0 }} />

        {/* Page-frame chrome + ProseMirror editors (z 5, self-positioned). */}
        {canvas && (
          <PageFrameDomLayer
            drawableCanvas={canvas}
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
        data-canvas-chrome-controls
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 20 }}
      />

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
    </div>
  );
}
