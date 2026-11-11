import { useEffect, useRef, useState } from 'react';
// KaTeX styles for math in page frames; the app imports this in its root CSS
// (src/index.css), so the editor's own styles.css does not carry it. Without
// it the MathML fallback renders as duplicate plain text under each formula.
import 'katex/dist/katex.min.css';
import { AllSelection } from 'prosemirror-state';
import { CanvasClipboardController } from '@myelin/editor/clipboard/controller';
import { DrawableCanvasClipboardAdapter } from '@myelin/editor/clipboard/drawable-canvas-adapter';
import { handlePageFrameImagePaste } from '@myelin/editor/clipboard/page-frame-image-paste';
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
import { defaultFlagTypes } from '@myelin/editor/flag-types';
import { I18nProvider, useMessages } from '@myelin/editor/i18n';
import { keybindings } from '@myelin/editor/keybinds';
import {
  getMediaImportHandler,
  type MediaImportOptions,
} from '@myelin/editor/media';
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
const EMBED_ACCEPT = 'application/pdf,image/*';

// PDFs and images keep their bytes in the document; audio and markdown need
// the app's media store and note repository.
function isEmbeddable(file: File): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('image/');
}

function embedFiles(
  canvas: DrawableCanvas,
  files: Iterable<File>,
  options?: MediaImportOptions,
): void {
  for (const file of files) {
    const handler = isEmbeddable(file) && getMediaImportHandler(file.type);
    if (!handler) {
      console.warn(`Can't embed ${file.name} (${file.type || 'unknown type'})`);
      continue;
    }
    void Promise.resolve(handler(file, canvas, options)).catch((error) =>
      console.warn(`Could not embed ${file.name}`, error),
    );
  }
}

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

// The app's canvas bindings (src/pages/canvas/hooks/use-engine.ts). Insert-embed
// opens a file picker in place of the app's embed composer.
function registerCanvasKeybindings(
  canvas: DrawableCanvas,
  openFilePicker: () => void,
): () => void {
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
    { action: 'canvas:insert-embed', onDown: openFilePicker },
    { action: 'canvas:flag-previous', onDown: () => canvas.stepFlag(-1) },
    { action: 'canvas:flag-next', onDown: () => canvas.stepFlag(1) },
    ...canvas.tools.map((tool, index) => ({
      action: TOOL_ACTIONS[tool.id],
      onDown: () => canvas.switchTool(index),
    })),
  ]);
}

// Copy, cut and paste of canvas elements, and pasting PDFs and images, as in the
// app.
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
  const handlePaste = (event: ClipboardEvent) => {
    if (
      handlePageFrameImagePaste(event, canvas, (files, target) =>
        embedFiles(canvas, files, { pageFramePaste: target }),
      )
    ) {
      return;
    }
    controller.handlePaste(event, adapter, (pasted) => {
      const files = Array.from(pasted.clipboardData?.files ?? []).filter(
        isEmbeddable,
      );
      embedFiles(canvas, files);
      return files.length > 0;
    });
  };
  document.addEventListener('copy', handleCopy);
  document.addEventListener('cut', handleCut);
  document.addEventListener('paste', handlePaste, true);
  return () => {
    document.removeEventListener('copy', handleCopy);
    document.removeEventListener('cut', handleCut);
    document.removeEventListener('paste', handlePaste, true);
  };
}

function bindFileDrop(
  target: HTMLCanvasElement,
  canvas: DrawableCanvas,
): () => void {
  const handleDragOver = (event: DragEvent) => event.preventDefault();
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    embedFiles(canvas, event.dataTransfer?.files ?? [], {
      screenX: event.clientX - rect.left,
      screenY: event.clientY - rect.top,
    });
  };
  target.addEventListener('dragover', handleDragOver);
  target.addEventListener('drop', handleDrop);
  return () => {
    target.removeEventListener('dragover', handleDragOver);
    target.removeEventListener('drop', handleDrop);
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
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const domHostRef = useRef<HTMLDivElement>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolState = useToolState(drawableCanvasRef);
  const [canvas, setCanvas] = useState<DrawableCanvas | null>(null);
  const [editingElement, setEditingElement] = useState<DrawableElement | null>(
    null,
  );
  const [insertOpen, setInsertOpen] = useState(false);
  const strings = useMessages();

  const { canvasTools, setSelectedToolIndex, hideOptions } = toolState;

  useEffect(() => {
    canvas?.setFlagTypes(defaultFlagTypes(strings));
  }, [canvas, strings]);

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

    const unregisterKeybindings = registerCanvasKeybindings(canvas, () =>
      fileInputRef.current?.click(),
    );
    const handleKeyDown = (event: KeyboardEvent) =>
      handleShapeEnter(canvas, event);
    document.addEventListener('keydown', handleKeyDown);
    const unbindClipboard = bindCanvasClipboard(canvas);
    const unbindFileDrop = bindFileDrop(fg, canvas);

    const stopLoop = startDrawableCanvasAnimationLoop(canvas, () => {});
    setCanvas(canvas);

    return () => {
      fg.removeEventListener('pointerdown', handlePointerDown);
      unregisterKeybindings();
      document.removeEventListener('keydown', handleKeyDown);
      unbindClipboard();
      unbindFileDrop();
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
      <input
        ref={fileInputRef}
        type="file"
        accept={EMBED_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          const input = event.currentTarget;
          if (canvas && input.files) {
            embedFiles(canvas, Array.from(input.files));
          }
          // Lets the same file be picked again.
          input.value = '';
        }}
      />
      {/* Canvas layers live in their own stage. The viewport attaches its
          wheel listener to the foreground canvas's parent and preventDefaults
          scrolling, so the toolbar must be a sibling of this stage (not a
          descendant) or its scrollable menus (e.g. the font picker) can't
          scroll. Isolated so the element-order z-indexes stay below the
          selection overlay and chrome controls. */}
      <div className="absolute inset-0 isolate">
        <canvas
          ref={bgRef}
          className={`${layerClass} pointer-events-none`}
          style={{ zIndex: 0 }}
        />

        {/* Page-frame chrome + ProseMirror editors (self-positioned). */}
        {canvas && (
          <PageFrameDomLayer
            drawableCanvas={canvas}
            editingElement={editingElement}
          />
        )}

        <div ref={domHostRef} className={`${layerClass} pointer-events-none`} />
        <canvas ref={fgRef} className={layerClass} />
      </div>
      <canvas
        ref={overlayRef}
        className={`${layerClass} pointer-events-none`}
        style={{ zIndex: 12 }}
      />

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
                onInsertEmbed={() => {
                  setInsertOpen(false);
                  fileInputRef.current?.click();
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
