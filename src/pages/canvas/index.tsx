import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Download,
  History,
  Redo2,
  Search,
  Undo2,
  WifiOff,
  X as XIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { buildCanvasPdfExportTarget } from '@myelin/editor/canvas-pdf-export';
import type { ChromeMenuItem } from '@myelin/editor/chrome-menu';
import { setChromeMenuOpener } from '@myelin/editor/chrome-menu';
import { useCanvasCommandContext } from '@myelin/editor/command-context';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { ElementType } from '@myelin/editor/elements/element-type';
import { PageFrameElement } from '@myelin/editor/elements/page-frame-element';
import { NOTE_LINK_OPEN_REQUEST_EVENT } from '@myelin/editor/events';
import {
  type ExportTarget,
  setExportDialogOpener,
} from '@myelin/editor/export/export-controller';
import { useMessages } from '@myelin/editor/i18n';
import { markdownImportHandler } from '@myelin/editor/media/markdown';
import { PageFrameDomLayer } from '@myelin/editor/page-frame/dom-layer';
import {
  getNoteLinkPreview,
  type NoteLinkPreviewTarget,
} from '@myelin/editor/page-frame/note-link/preview';
import type { NoteLinkOpenRequestDetail } from '@myelin/editor/page-frame/pm/markdown/note-links';
import { usePageFrameAutocomplete } from '@myelin/editor/page-frame/use-page-frame-autocomplete';
import { PenPresetsProvider } from '@myelin/editor/pen-presets';
import { getPlatform } from '@myelin/editor/platform';
import { regenerateThumbnailNow } from '@myelin/editor/thumbnails';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { Logger } from '@myelin/shared/logger';
import { usePresence } from '@myelin/ui';
import { Button } from '@myelin/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import { WheelPicker, type WheelPickerHandle } from '@/components/wheel-picker';
import { IS_DEV } from '@/lib/env';
import { openNote, openNoteLink } from '@/lib/note/navigation';
import { useRepository, type VFSNodeId } from '@/lib/sync';
import { usePaneId, useTabController } from '@/lib/tabs/context';
import { useUserPref } from '@/lib/use-user-pref';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';
import { RenameReferencesDialog } from '@/pages/library/explorer/rename-references-dialog';
import { BacklinksChip } from './components/backlinks-chip';
import { CanvasSearch } from './components/canvas-search';
import { CanvasToolbar } from './components/canvas-toolbar';
import { ChromeMenu } from './components/chrome-menu';
import { EmbedComposer } from './components/embed-composer';
import { ExportDialog } from './components/export-dialog';
import { InsertPopover } from './components/insert-popover';
import { PeerSyncPanel } from './components/peer-sync-panel';
import { SelectionToolbar } from './components/selection-toolbar';
import { StatusBar } from './components/status-bar';
import { TitleBar, TitleBarTooltip } from './components/title-bar';
import { useEmbedFiles } from './hooks/use-embed-files';
import { useCanvasEngine } from './hooks/use-engine';
import { useCanvasInserts } from './hooks/use-inserts';
import { useLivePeerDiscovery } from './hooks/use-live-peer-discovery';
import { usePencilGestures } from './hooks/use-pencil-gestures';
import { useToolState } from './hooks/use-tool-state';
import { useCanvasSearch } from './search/use-canvas-search';

const logger = new Logger('CanvasView');

// The wheel's rings sit at fixed offsets outside this radius, so the default 100 spans 478px —
// wider than any phone. 52 brings the outer ring to 382px, clearing a 390px portrait screen.
const COMPACT_WHEEL_RADIUS = 52;

interface CanvasViewProps {
  id: VFSNodeId;
  initialPageFrameName?: string | null;
  initialPageFrameId?: string | null;
}

export function CanvasView({
  id,
  initialPageFrameName,
  initialPageFrameId,
}: CanvasViewProps) {
  return (
    <PenPresetsProvider>
      <CanvasViewInner
        id={id}
        initialPageFrameName={initialPageFrameName}
        initialPageFrameId={initialPageFrameId}
      />
    </PenPresetsProvider>
  );
}

function CanvasViewInner({
  id,
  initialPageFrameName: initialPageFrameNameProp,
  initialPageFrameId: initialPageFrameIdProp,
}: CanvasViewProps) {
  const tabController = useTabController();
  const paneId = usePaneId();
  const repository = useRepository();
  const strings = useMessages();
  const thumbnailRootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgHostRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const wheelRef = useRef<WheelPickerHandle>(null);
  const drawableCanvasRef = useRef<DrawableCanvas | null>(null);
  const domOverlayRef = useRef<HTMLDivElement>(null);
  const { registerHandlers } = useCanvasCommandContext();
  const toolState = useToolState(drawableCanvasRef);
  usePencilGestures({
    drawableCanvasRef,
    wheelRef,
    canvasTools: toolState.canvasTools,
    selectedToolIndex: toolState.selectedToolIndex,
    toggleOptions: toolState.toggleOptions,
  });
  const canvasSearch = useCanvasSearch(drawableCanvasRef, id);

  const [chromeMenu, setChromeMenu] = useState<{
    anchor: DOMRect;
    items: ChromeMenuItem[];
  } | null>(null);

  const [zoomLocked, setZoomLocked] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);
  const onToggleZoomLock = useCallback(() => {
    setZoomLocked((prev) => {
      const next = !prev;
      drawableCanvasRef.current?.viewport.setZoomLocked(next);
      return next;
    });
  }, []);
  const onRecenterViewport = useCallback(() => {
    drawableCanvasRef.current?.viewport.animateRecenter();
  }, []);
  const onUndo = useCallback(() => {
    drawableCanvasRef.current?.undo();
  }, []);
  const onRedo = useCallback(() => {
    drawableCanvasRef.current?.redo();
  }, []);
  const onRegenerateThumbnail = useCallback(() => {
    void regenerateThumbnailNow(id);
  }, [id]);

  useEffect(() => {
    setChromeMenuOpener((anchor, items) => setChromeMenu({ anchor, items }));
    return () => setChromeMenuOpener(() => {});
  }, []);

  useEffect(() => {
    setExportDialogOpener((target) => setExportTarget(target));
    return () => setExportDialogOpener(null);
  }, []);

  const embedFiles = useEmbedFiles(drawableCanvasRef);
  const inserts = useCanvasInserts({
    drawableCanvasRef,
    canvasTools: toolState.canvasTools,
    selectedToolIndex: toolState.selectedToolIndex,
    embedFiles,
  });

  const targetPageFrameName = initialPageFrameNameProp ?? null;
  const targetPageFrameId = initialPageFrameIdProp ?? null;

  const engine = useCanvasEngine({
    id,
    thumbnailRootRef,
    canvasRef,
    bgHostRef,
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
  const liveDiscoveryPauseError = useLivePeerDiscovery(engine.noteSession);
  const onExportCanvasPdf = useCallback(() => {
    const canvas = drawableCanvasRef.current;
    if (!canvas) {
      return;
    }
    setExportTarget(
      buildCanvasPdfExportTarget(canvas, engine.fileName || 'Canvas'),
    );
  }, [engine.fileName]);

  useEffect(() => {
    // engine.fileName lags `id` during a tab switch because CanvasView is reused, not remounted, and
    // the session opens asynchronously — otherwise the previous note's name is briefly written onto
    // the new tab.
    if (engine.fileName && engine.noteSession?.id === id) {
      const pane = tabController.getPane(paneId);
      if (!pane) {
        return;
      }
      const tab = pane.tabs.find(
        (t) => t.target.type === 'canvas' && t.target.id === id,
      );
      if (tab) {
        tabController.updateTabTitle(tab.id, engine.fileName);
      }
    }
  }, [engine.fileName, engine.noteSession, tabController, paneId, id]);

  useEffect(() => {
    if (!engine.ready) {
      return;
    }
    // Same lag as the title effect above: until the loaded session matches this tab's id,
    // drawableCanvasRef.current still points at the previous note's document, so the focus/create
    // fallback below would create a page frame in the wrong canvas.
    if (engine.noteSession?.id !== id) {
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
        (uuid) =>
          new PageFrameElement(
            uuid,
            targetPageFrameName,
            UserPrefs.get('defaultPageLayout'),
          ),
      );
      frame.setOffset(
        centerWorld.x - frame.totalWidth / 2,
        centerWorld.y - frame.totalHeight / 2,
      );
      frame.updateBounds();
      dc.focusPageFrameById(frame.uuid);
      return;
    }
    logger.debug('Requested page frame target was not found', {
      pageFrameName: targetPageFrameName,
      pageFrameId: targetPageFrameId,
    });
  }, [
    engine.ready,
    engine.noteSession,
    id,
    targetPageFrameId,
    targetPageFrameName,
  ]);

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
      await openNoteLink(tabController, repository, id, detail);
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
  // A custom canvas color overrides the theme's `bg-page` fill on the surface
  // behind the background pattern.
  const bgColorMode = useUserPref('canvasBackgroundColorMode');
  const customBgColor = useUserPref('canvasBackgroundColor');
  const surfaceStyle =
    bgColorMode === 'custom' ? { backgroundColor: customBgColor } : undefined;
  const loadNoteLinkPreview = useCallback(
    (target: NoteLinkPreviewTarget, signal: AbortSignal) =>
      getNoteLinkPreview(repository, target, signal),
    [repository],
  );
  const openBacklinkSource = useEffectEvent(async (sourceId: VFSNodeId) => {
    await engine.saveBeforeExit();
    openNote(
      tabController,
      { fileType: 'mcanvas', id: sourceId },
      undefined,
      'backlink',
    );
  });
  const handleOpenBacklinkSource = useCallback((sourceId: VFSNodeId) => {
    void openBacklinkSource(sourceId).catch((error) => {
      logger.error('Failed to open backlink source', error, {
        sourceId,
      });
      toast.error('Failed to open backlink', {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  }, []);
  const handleBeforeVersionRestore = useCallback(async () => {
    await engine.saveBeforeExit();
  }, [engine.saveBeforeExit]);
  const handleVersionRestored = useCallback(async () => {
    await engine.reopenSession();
  }, [engine.reopenSession]);
  const titleTrailing = useMemo(() => {
    const liveSyncPausedTitle =
      liveDiscoveryPauseError?.message ?? strings.canvas.peerSync.livePaused;
    const undoLabel = strings.settings.keybinds.actions['canvas:undo'].label;
    const redoLabel = strings.settings.keybinds.actions['canvas:redo'].label;
    const findLabel = strings.settings.keybinds.actions['canvas:find'].label;

    return (
      <>
        {liveDiscoveryPauseError && (
          <span
            role="status"
            title={liveSyncPausedTitle}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-destructive/5 px-2 py-1 font-medium text-[10px] text-destructive"
          >
            <WifiOff className="size-3" />
            <span>{strings.canvas.peerSync.livePaused}</span>
          </span>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={canvasSearch.openSearch}
                  aria-label={findLabel}
                  disabled={!engine.ready}
                />
              }
            >
              <Search className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              <TitleBarTooltip label={findLabel} action="canvas:find" />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onUndo}
                  aria-label={undoLabel}
                  disabled={!engine.ready}
                />
              }
            >
              <Undo2 className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              <TitleBarTooltip label={undoLabel} action="canvas:undo" />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={onRedo}
                  aria-label={redoLabel}
                  disabled={!engine.ready}
                />
              }
            >
              <Redo2 className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              <TitleBarTooltip label={redoLabel} action="canvas:redo" />
            </TooltipContent>
          </Tooltip>
          {getPlatform().pdfExport && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={onExportCanvasPdf}
                    aria-label={strings.canvas.export.exportCanvasPdf}
                    disabled={!engine.ready}
                  />
                }
              >
                <Download className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>
                {strings.canvas.export.exportCanvasPdf}
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setVersionHistoryOpen(true)}
                  aria-label={strings.versionHistory.title}
                  disabled={!id}
                />
              }
            >
              <History className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{strings.versionHistory.title}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <BacklinksChip noteId={id} onOpenSource={handleOpenBacklinkSource} />
      </>
    );
  }, [
    handleOpenBacklinkSource,
    onExportCanvasPdf,
    onUndo,
    onRedo,
    canvasSearch.openSearch,
    id,
    engine.ready,
    liveDiscoveryPauseError,
    strings.canvas.peerSync.livePaused,
    strings.canvas.export.exportCanvasPdf,
    strings.versionHistory.title,
    strings.settings.keybinds.actions,
  ]);
  const insertPopover = useMemo(
    () => (
      <InsertPopover
        onInsertFrame={inserts.onInsertFrame}
        onInsertEmbed={inserts.onInsertEmbed}
        onInsertLatex={inserts.onInsertLatex}
        onInsertAudio={inserts.onInsertAudio}
        onInsertCamera={inserts.onInsertCamera}
        onClose={inserts.closeInsert}
      />
    ),
    [
      inserts.closeInsert,
      inserts.onInsertEmbed,
      inserts.onInsertFrame,
      inserts.onInsertLatex,
      inserts.onInsertAudio,
      inserts.onInsertCamera,
    ],
  );
  const embedPresence = usePresence(inserts.embedOpen);
  const embedComposer = embedPresence.mounted ? (
    <EmbedComposer
      presenceState={embedPresence.state}
      onAnimationEnd={embedPresence.onAnimationEnd}
      onEmbedFiles={inserts.submitEmbed}
      onClose={inserts.closeEmbed}
    />
  ) : null;
  const wheelCenterIcon = useMemo(
    () => <XIcon className="size-4 text-text-on-dark" />,
    [],
  );

  // overflow-clip, not -hidden: hidden boxes are still programmatically scrollable, so the browser's
  // caret-reveal for offscreen page-frame carets can scroll them and desync the DOM from the canvas.
  return (
    <div
      data-canvas-root
      className="relative h-full w-full overflow-clip bg-page"
      style={surfaceStyle}
    >
      <div
        ref={thumbnailRootRef}
        data-thumbnail-root="true"
        className="absolute inset-0 overflow-clip bg-page"
        style={surfaceStyle}
      >
        {/* Background layer: dot grid, as a repeating CSS background rather
            than a canvas — panning it is a compositor translate that
            rasterizes nothing. Position and size are written by CanvasRenderer,
            which owns the overdraw the pan translate depends on. */}
        <div
          ref={bgHostRef}
          data-thumbnail-exclude="true"
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

        {/* Foreground canvas: strokes, images, element content */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 block h-full w-full touch-none"
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
          canvas so clicks reach the buttons first. Below UI chrome (toolbars,
          modals at z-100+). Pointer-events-none by default; individual buttons
          opt in. */}
      <div
        data-canvas-chrome-controls
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ zIndex: 20 }}
      />

      <StatusBar
        zoomLevel={engine.zoomLevel}
        fps={engine.fps}
        zoomLocked={zoomLocked}
        onToggleZoomLock={onToggleZoomLock}
        onRecenter={onRecenterViewport}
        onRegenerateThumbnail={onRegenerateThumbnail}
      />
      {engine.ready && (
        <SelectionToolbar drawableCanvasRef={drawableCanvasRef} />
      )}
      {IS_DEV && (
        <PeerSyncPanel session={engine.noteSession} status={engine.status} />
      )}
      <TitleBar trailing={titleTrailing} />

      <CanvasToolbar
        tools={toolState.canvasTools}
        selectedToolIndex={toolState.selectedToolIndex}
        optionsVisible={toolState.optionsVisible}
        shelfOpen={toolState.shelfOpen}
        insertOpen={inserts.insertOpen}
        activeOptions={toolState.activeOptions}
        hasOptions={toolState.hasOptions}
        wheelEnabledIndices={toolState.wheelEnabledIndices}
        presets={toolState.presets}
        matchedPresetId={toolState.matchedPresetId}
        activePenTool={toolState.activePenTool}
        wheelFull={toolState.wheelFull}
        savePresetDisabledReason={toolState.savePresetDisabledReason}
        onApplyPreset={toolState.applyPreset}
        onSavePreset={toolState.saveCurrentAsPreset}
        onUpdatePresetToCurrent={toolState.updatePresetToCurrent}
        onTogglePresetInWheel={toolState.togglePresetInWheel}
        onDeletePreset={toolState.deletePreset}
        onSelectTool={toolState.selectTool}
        onToggleOptions={toolState.toggleOptions}
        onToggleShelf={toolState.toggleShelf}
        onCloseShelf={toolState.closeShelf}
        onToggleInsert={inserts.toggleInsert}
        onToggleWheelTool={toolState.handleToggleWheelTool}
        insertPopover={insertPopover}
        embedComposer={embedComposer}
      />

      {inserts.contextInsert && (
        <div
          className="pointer-events-auto absolute z-20"
          style={{
            left: inserts.contextInsert.screenX,
            top: inserts.contextInsert.screenY,
          }}
        >
          <InsertPopover
            onInsertFrame={inserts.onContextInsertFrame}
            onInsertEmbed={inserts.onContextInsertEmbed}
            onInsertLatex={inserts.onContextInsertLatex}
            onInsertAudio={inserts.onContextInsertAudio}
            onInsertCamera={inserts.onContextInsertCamera}
            onClose={inserts.closeContextInsert}
          />
        </div>
      )}

      <div
        style={{ zIndex: 100 }}
        className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto"
      >
        <WheelPicker
          ref={wheelRef}
          radius={IS_PHONE_BUILD ? COMPACT_WHEEL_RADIUS : 100}
          items={toolState.wheelItems}
        >
          {wheelCenterIcon}
        </WheelPicker>
      </div>

      {chromeMenu && (
        <ChromeMenu
          anchor={chromeMenu.anchor}
          items={chromeMenu.items}
          onClose={() => setChromeMenu(null)}
        />
      )}

      <CanvasSearch controller={canvasSearch} />

      <RenameReferencesDialog
        prompt={engine.pageFrameRenamePrompt}
        onChoice={engine.choosePageFrameRenameReferences}
      />
      <ExportDialog
        target={exportTarget}
        onClose={() => setExportTarget(null)}
      />
      {id && (
        <VersionHistoryDialog
          open={versionHistoryOpen}
          onOpenChange={setVersionHistoryOpen}
          fileId={id}
          fileName={engine.fileName}
          fileType="mcanvas"
          onBeforeRestore={handleBeforeVersionRestore}
          onRestored={handleVersionRestored}
        />
      )}
    </div>
  );
}
