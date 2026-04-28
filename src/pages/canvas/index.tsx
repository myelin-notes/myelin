import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { X as XIcon } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { WheelPicker, type WheelPickerHandle } from '@/components/wheel-picker';
import { CustomColorsProvider } from '@/lib/custom-colors';
import { IS_DEV } from '@/lib/env';
import { NOTE_LINK_OPEN_REQUEST_EVENT } from '@/lib/events';
import { Logger } from '@/lib/logger';
import { openNoteLink } from '@/lib/note-navigation';
import { useRepository } from '@/lib/sync';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import type { ChromeMenuItem } from './chrome-menu';
import { setChromeMenuOpener } from './chrome-menu';
import { useCanvasCommandContext } from './command-context';
import { CanvasToolbar } from './components/canvas-toolbar';
import { ChromeMenu } from './components/chrome-menu';
import { EmbedComposer } from './components/embed-composer';
import { InsertPopover } from './components/insert-popover';
import { PeerSyncPanel } from './components/peer-sync-panel';
import { StatusBar } from './components/status-bar';
import { TitleBar } from './components/title-bar';
import { ElementType } from './elements/element-type';
import type { PageFrameElement } from './elements/page-frame-element';
import { useEmbedFiles } from './hooks/use-embed-files';
import { useCanvasEngine } from './hooks/use-engine';
import { useCanvasInserts } from './hooks/use-inserts';
import { useToolState } from './hooks/use-tool-state';
import { markdownImportHandler } from './media/markdown';
import { PageFrameDomLayer } from './page-frame/dom-layer';
import {
  getNoteLinkPreview,
  type NoteLinkPreviewTarget,
} from './page-frame/note-link-preview';
import type { NoteLinkOpenRequestDetail } from './page-frame/pm/markdown/note-links';
import { usePageFrameAutocomplete } from './page-frame/use-page-frame-autocomplete';

const logger = new Logger('CanvasView');

export function CanvasView() {
  return (
    <CustomColorsProvider>
      <CanvasViewInner />
    </CustomColorsProvider>
  );
}

function CanvasViewInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const repository = useRepository();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<WheelPickerHandle>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const domOverlayRef = useRef<HTMLDivElement>(null);
  const { registerHandlers } = useCanvasCommandContext();
  const toolState = useToolState(drawableCanvasRef);

  const [chromeMenu, setChromeMenu] = useState<{
    anchor: DOMRect;
    items: ChromeMenuItem[];
  } | null>(null);

  useEffect(() => {
    setChromeMenuOpener((anchor, items) => setChromeMenu({ anchor, items }));
    return () => setChromeMenuOpener(() => {});
  }, []);

  const embedFiles = useEmbedFiles(drawableCanvasRef);
  const inserts = useCanvasInserts({
    drawableCanvasRef,
    canvasTools: toolState.canvasTools,
    selectedToolIndex: toolState.selectedToolIndex,
    embedFiles,
  });

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
    onInsertFrame: inserts.onInsertFrame,
    onInsertEmbed: inserts.onInsertEmbed,
    embedFiles,
  });

  const importMarkdownFile = useCallback(
    async (file: File) => {
      const dc = drawableCanvasRef.current;
      if (!dc) {
        throw new Error('Canvas is still loading.');
      }
      await markdownImportHandler(file, dc, { repository });
    },
    [repository],
  );
  useEffect(() => {
    if (!engine.ready) {
      return;
    }

    return registerHandlers({ importMarkdownFile });
  }, [engine.ready, importMarkdownFile, registerHandlers]);

  const activeEditorView =
    engine.editingElement?.type === ElementType.PAGE_FRAME
      ? ((engine.editingElement as PageFrameElement).pmEditor?.view ?? null)
      : null;
  const openPageFrameNoteLink = useEffectEvent(
    async (detail: NoteLinkOpenRequestDetail) => {
      if (!id) {
        return;
      }

      await engine.saveBeforeExit();
      await openNoteLink(navigate, repository, id, detail);
    },
  );
  useEffect(() => {
    if (!activeEditorView) {
      return;
    }

    const handleOpenRequest = (event: Event) => {
      const { detail } = event as CustomEvent<NoteLinkOpenRequestDetail>;
      void openPageFrameNoteLink(detail).catch((error) => {
        logger.error('Failed to open note link', error);
        toast.error('Failed to open note link', {
          description: error instanceof Error ? error.message : String(error),
        });
      });
    };

    activeEditorView.dom.addEventListener(
      NOTE_LINK_OPEN_REQUEST_EVENT,
      handleOpenRequest,
    );
    return () => {
      activeEditorView.dom.removeEventListener(
        NOTE_LINK_OPEN_REQUEST_EVENT,
        handleOpenRequest,
      );
    };
  }, [activeEditorView]);
  const pageFrameAutocomplete = usePageFrameAutocomplete({
    repository,
    view: activeEditorView,
  });
  const loadNoteLinkPreview = useCallback(
    (target: NoteLinkPreviewTarget, signal: AbortSignal) =>
      getNoteLinkPreview(repository, target, signal),
    [repository],
  );

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
        autocompleteController={pageFrameAutocomplete.controller}
        onAutocompleteSelect={pageFrameAutocomplete.onSelectItem}
        loadNoteLinkPreview={loadNoteLinkPreview}
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
        onClick={inserts.onCanvasClick}
      />

      {/* Selection overlay canvas: outline + handles. Always above DOM chrome
          so selection stays visible while editing. */}
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
      {IS_DEV && (
        <PeerSyncPanel session={engine.noteSession} status={engine.status} />
      )}
      <TitleBar fileName={engine.fileName} onBack={engine.back} />

      <CanvasToolbar
        tools={toolState.canvasTools}
        selectedToolIndex={toolState.selectedToolIndex}
        optionsVisible={toolState.optionsVisible}
        shelfOpen={toolState.shelfOpen}
        insertOpen={inserts.insertOpen}
        activeOptions={toolState.activeOptions}
        hasOptions={toolState.hasOptions}
        wheelEnabledIndices={toolState.wheelEnabledIndices}
        onSelectTool={toolState.selectTool}
        onToggleOptions={toolState.toggleOptions}
        onToggleShelf={toolState.toggleShelf}
        onCloseShelf={toolState.closeShelf}
        onToggleInsert={inserts.toggleInsert}
        onToggleWheelTool={toolState.handleToggleWheelTool}
        insertPopover={
          <InsertPopover
            onInsertFrame={inserts.onInsertFrame}
            onInsertEmbed={inserts.onInsertEmbed}
            onClose={inserts.closeInsert}
          />
        }
        embedComposer={
          <AnimatePresence>
            {inserts.embedOpen && (
              <EmbedComposer
                key="embed-composer"
                onEmbedFiles={inserts.submitEmbed}
                onClose={inserts.closeEmbed}
              />
            )}
          </AnimatePresence>
        }
      />

      <AnimatePresence>
        {inserts.contextInsert && (
          <div
            key="context-insert"
            className="pointer-events-auto absolute z-20"
            style={{
              left: inserts.contextInsert.screenX,
              top: inserts.contextInsert.screenY,
            }}
          >
            <InsertPopover
              onInsertFrame={inserts.onContextInsertFrame}
              onInsertEmbed={inserts.onContextInsertEmbed}
              onClose={inserts.closeContextInsert}
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
