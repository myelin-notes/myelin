import { useEffect, useRef, useState } from 'react';
// KaTeX styles for math in page frames; the app imports this in its root CSS
// (src/index.css), so the editor's own styles.css does not carry it. Without
// it the MathML fallback renders as duplicate plain text under each formula.
import 'katex/dist/katex.min.css';
import { AllSelection } from 'prosemirror-state';
import { CanvasClipboardController } from '@myelin/editor/clipboard/controller';
import { DrawableCanvasClipboardAdapter } from '@myelin/editor/clipboard/drawable-canvas-adapter';
import { InsertPopover } from '@myelin/editor/components/insert-popover';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { DrawableElement } from '@myelin/editor/elements/drawable-element';
import { ElementType } from '@myelin/editor/elements/element-type';
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
import { I18nProvider } from '@myelin/editor/i18n';
import { keybindings } from '@myelin/editor/keybinds';
import { PageFrameDomLayer } from '@myelin/editor/page-frame/dom-layer';
import { startDrawableCanvasAnimationLoop } from '@myelin/editor/render-loop';
import { TOOL_ACTIONS } from '@myelin/editor/tools/tool-keybinds';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { CanvasToolbar } from '@/components/canvas-toolbar';
import { SelectionToolbar } from '@/components/selection-toolbar';
import { SiteCopyProvider } from '@/content/copy-context';
import { useToolState } from '@/hooks/use-tool-state';
import { CustomColorsProvider } from '@/lib/custom-colors';
import type { Locale } from '@/lib/locale';
import {
  persistTryCanvas,
  persistTryCanvasView,
} from '@/lib/try-canvas-storage';
import { initWebPlatform } from '@/lib/web-platform';

const layerClass = 'absolute inset-0 h-full w-full';

function startPageFramePlacement(canvas: DrawableCanvas): void {
  canvas.startPlacement({
    getBounds: () => ({
      x: -CHROME_SIDE_PADDING,
      y: -CHROME_HEADER_HEIGHT,
      width: PAGE_WIDTH + CHROME_SIDE_PADDING * 2,
      height: PAGE_HEIGHT + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
    }),
    onPlace: (worldPos) => {
      const frame = canvas.addElement(
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
    },
  });
}

function startLatexPlacement(canvas: DrawableCanvas): void {
  canvas.startPlacement({
    getBounds: () => ({ x: 0, y: 0, width: 140, height: 44 }),
    onPlace: (worldPos) => {
      const latex = canvas.addElement((uuid) => {
        const element = new LatexElement(uuid);
        element.setOffset(worldPos.x, worldPos.y);
        return element;
      });
      latex.updateBounds();
      latex.select();
      // Placement runs inside a canvas pointerdown; entering edit now would
      // register a click-outside listener that the same event, still bubbling
      // to document, immediately trips. Defer past this event.
      requestAnimationFrame(() => canvas.enterElementEdit(latex));
    },
  });
}

// The app's canvas bindings (src/pages/canvas/hooks/use-engine.ts), minus the
// insert-embed composer, which needs the app's media store.
function registerCanvasKeybindings(canvas: DrawableCanvas): () => void {
  return keybindings.register([
    {
      action: 'canvas:pan',
      onDown: () => canvas.setSpaceDown(true),
      onUp: () => canvas.setSpaceDown(false),
    },
    { action: 'canvas:undo', onDown: () => canvas.undo() },
    { action: 'canvas:redo', onDown: () => canvas.redo() },
    {
      action: 'canvas:select-all',
      onDown: (event) => {
        event.preventDefault();
        const editing = canvas.editingElement;
        const view =
          editing instanceof PageFrameElement ? editing.pmEditor?.view : null;
        if (view) {
          view.dispatch(
            view.state.tr.setSelection(new AllSelection(view.state.doc)),
          );
          view.focus();
          return;
        }
        canvas.selectAllElements();
      },
    },
    { action: 'canvas:delete', onDown: () => canvas.deleteSelected() },
    {
      action: 'canvas:insert-frame',
      onDown: () => startPageFramePlacement(canvas),
    },
    ...canvas.tools.map((tool, index) => ({
      action: TOOL_ACTIONS[tool.id],
      onDown: () => canvas.switchTool(index),
    })),
  ]);
}

// Copy, cut and paste of canvas elements, as in the app. Pasted media is not
// embedded: that needs the app's media store.
function bindCanvasClipboard(canvas: DrawableCanvas): () => void {
  // The id only tells same-canvas pastes apart, so they land offset.
  const adapter = new DrawableCanvasClipboardAdapter(
    { current: canvas },
    'try',
  );
  const controller = new CanvasClipboardController();
  const handleCopy = (event: ClipboardEvent) =>
    controller.handleCopy(event, adapter);
  const handleCut = (event: ClipboardEvent) =>
    controller.handleCut(event, adapter);
  const handlePaste = (event: ClipboardEvent) =>
    controller.handlePaste(event, adapter);
  document.addEventListener('copy', handleCopy);
  document.addEventListener('cut', handleCut);
  document.addEventListener('paste', handlePaste, true);
  return () => {
    document.removeEventListener('copy', handleCopy);
    document.removeEventListener('cut', handleCut);
    document.removeEventListener('paste', handlePaste, true);
  };
}

// Enter on a single selected shape edits its label, as in the app.
function handleShapeEnter(canvas: DrawableCanvas, event: KeyboardEvent): void {
  if (
    event.key !== 'Enter' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input, textarea, button, select, a[href]'))
  ) {
    return;
  }
  const selected = canvas.getSelectedElements();
  if (
    canvas.editingElement ||
    selected.length !== 1 ||
    selected[0].type !== ElementType.SHAPE
  ) {
    return;
  }
  event.preventDefault();
  canvas.enterElementEdit(selected[0], event);
}

/**
 * The try-it page: the real Myelin canvas engine with the app's tool rail, on
 * a Y.Doc kept in IndexedDB.
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
  const [insertOpen, setInsertOpen] = useState(false);

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
    const stopPersisting = persistTryCanvas(ydoc.doc);
    const canvas = new DrawableCanvas(fg, ydoc, canvasTools);
    const stopPersistingView = persistTryCanvasView(canvas.viewport);
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

    const unregisterKeybindings = registerCanvasKeybindings(canvas);
    const handleKeyDown = (event: KeyboardEvent) =>
      handleShapeEnter(canvas, event);
    document.addEventListener('keydown', handleKeyDown);
    const unbindClipboard = bindCanvasClipboard(canvas);

    const stopLoop = startDrawableCanvasAnimationLoop(canvas, () => {});
    setCanvas(canvas);

    return () => {
      fg.removeEventListener('pointerdown', handlePointerDown);
      unregisterKeybindings();
      document.removeEventListener('keydown', handleKeyDown);
      unbindClipboard();
      stopLoop();
      stopPersisting();
      stopPersistingView();
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
            insertOpen={insertOpen}
            onToggleInsert={() => setInsertOpen((open) => !open)}
            insertPopover={
              <InsertPopover
                onInsertFrame={() => {
                  setInsertOpen(false);
                  startPageFramePlacement(canvas);
                }}
                onInsertLatex={() => {
                  setInsertOpen(false);
                  startLatexPlacement(canvas);
                }}
                onClose={() => setInsertOpen(false)}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
