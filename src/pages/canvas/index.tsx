import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { X as XIcon } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { WheelPicker, type WheelPickerHandle } from '@/components/wheel-picker';
import { CustomColorsProvider } from '@/lib/custom-colors';
import { IS_DEV } from '@/lib/env';
import { NOTE_LINK_OPEN_REQUEST_EVENT } from '@/lib/events';
import { Logger } from '@/lib/logger';
import { openNote, openNoteLink } from '@/lib/note-navigation';
import { useRepository, type VFSNodeId } from '@/lib/sync';
import { UserPrefs } from '@/lib/user-prefs';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { RenameReferencesDialog } from '@/pages/library/explorer/rename-references-dialog';
import type { ChromeMenuItem } from './chrome-menu';
import { setChromeMenuOpener } from './chrome-menu';
import { useCanvasCommandContext } from './command-context';
import { BacklinksChip } from './components/backlinks-chip';
import { CanvasToolbar } from './components/canvas-toolbar';
import { ChromeMenu } from './components/chrome-menu';
import { EmbedComposer } from './components/embed-composer';
import { InsertPopover } from './components/insert-popover';
import { PeerSyncPanel } from './components/peer-sync-panel';
import { StatusBar } from './components/status-bar';
import { TitleBar } from './components/title-bar';
import { ElementType } from './elements/element-type';
import { PageFrameElement } from './elements/page-frame-element';
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
  const { id } = useParams<{ id: VFSNodeId }>();
  const navigate = useNavigate();
  const location = useLocation();
  const repository = useRepository();
  const thumbnailRootRef = useRef<HTMLDivElement>(null);
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

  const targetPageFrameName = useMemo(() => {
    if (!location.hash) {
      return null;
    }

    const rawHash = location.hash.slice(1);
    try {
      return decodeURIComponent(rawHash).trim() || null;
    } catch {
      return rawHash.trim() || null;
    }
  }, [location.hash]);
  const routeState = location.state as { pageFrameId?: unknown } | null;
  const targetPageFrameId =
    typeof routeState?.pageFrameId === 'string' ? routeState.pageFrameId : null;

  const engine = useCanvasEngine({
    id,
    initialPageFrameName: targetPageFrameName,
    thumbnailRootRef,
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

  useEffect(() => {
    if (!engine.ready) {
      return;
    }
    if (!targetPageFrameId && !targetPageFrameName) {
      return;
    }

    const dc = drawableCanvasRef.current;
    if (!dc) {
      return;
    }
    if (targetPageFrameId && dc.focusPageFrameById(targetPageFrameId)) {
      return;
    }
    if (targetPageFrameName && dc.focusPageFrameByName(targetPageFrameName)) {
      return;
    }
    if (targetPageFrameName) {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const centerWorld = dc.viewport.screenToWorld({
        x: canvas.width / dpr / 2,
        y: canvas.height / dpr / 2,
      });
      const frame = dc.addElement(
        (uuid) => new PageFrameElement(uuid, targetPageFrameName),
      );
      frame.setOffset(
        centerWorld.x - frame.pageWidth / 2,
        centerWorld.y - frame.pageHeight / 2,
      );
      frame.updateBounds();
      dc.updateBounding();
      dc.focusPageFrameById(frame.uuid);
      return;
    }
    logger.debug('Requested page frame target was not found', {
      pageFrameName: targetPageFrameName,
      pageFrameId: targetPageFrameId,
    });
  }, [engine.ready, targetPageFrameId, targetPageFrameName]);

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
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(
    UserPrefs.get('noteLinkHoverPreview'),
  );
  useEffect(() => {
    return UserPrefs.subscribe('noteLinkHoverPreview', setHoverPreviewEnabled);
  }, []);
  const loadNoteLinkPreview = useCallback(
    (target: NoteLinkPreviewTarget, signal: AbortSignal) =>
      getNoteLinkPreview(repository, target, signal),
    [repository],
  );
  const openBacklinkSource = useEffectEvent(async (sourceId: VFSNodeId) => {
    await engine.saveBeforeExit();
    openNote(navigate, { fileType: 'mcanvas', id: sourceId });
  });

  return (
    <div className="relative h-full w-full overflow-hidden bg-page">
      <div
        ref={thumbnailRootRef}
        data-thumbnail-root="true"
        className="absolute inset-0 overflow-hidden bg-page"
      >
        {/* Background canvas: dot grid */}
        <canvas
          ref={bgCanvasRef}
          data-thumbnail-exclude="true"
          className="absolute inset-0 block h-full w-full"
          style={{ zIndex: 0 }}
        />

        {/* DOM layer: page chrome + PM editor text */}
        <PageFrameDomLayer
          canvasRef={engine.drawableCanvasRef}
          editingElement={engine.editingElement}
          autocompleteController={pageFrameAutocomplete.controller}
          autocompleteKind={pageFrameAutocomplete.activeKind}
          onAutocompleteSelect={pageFrameAutocomplete.onSelectItem}
          loadNoteLinkPreview={
            hoverPreviewEnabled ? loadNoteLinkPreview : undefined
          }
        />

        {/* Element-owned DOM overlay */}
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
      </div>

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
      <TitleBar
        fileName={engine.fileName}
        onBack={engine.back}
        trailing={
          <BacklinksChip
            noteId={id}
            onOpenSource={(sourceId) => {
              void openBacklinkSource(sourceId).catch((error) => {
                logger.error('Failed to open backlink source', error, {
                  sourceId,
                });
                toast.error('Failed to open backlink', {
                  description:
                    error instanceof Error ? error.message : String(error),
                });
              });
            }}
          />
        }
      />

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

      <RenameReferencesDialog
        prompt={engine.pageFrameRenamePrompt}
        onChoice={engine.choosePageFrameRenameReferences}
      />
    </div>
  );
}
