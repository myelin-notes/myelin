import type * as Y from 'yjs';
import { Logger } from '@myelin/shared/logger';
import { CanvasDocumentBinding } from './canvas-document-binding';
import { CanvasElementFactory } from './canvas-element-factory';
import {
  CanvasInteractionController,
  coalescedPointerSamples,
  isStylusTouch,
} from './canvas-interaction-controller';
import { CanvasRenderer } from './canvas-renderer';
import { CanvasViewport } from './canvas-viewport';
import { EditSessionController } from './edit-session-controller';
import {
  canMoveElementOrderForSelection,
  type ElementOrderItem,
  type ElementReorderDirection,
  moveElementOrderForSelection,
} from './element-ordering';
import { BookmarkElement } from './elements/bookmark-element';
import type { CanvasUiServices } from './elements/canvas-element-context';
import type {
  DrawableElement,
  ResizeHandle,
} from './elements/drawable-element';
import type { ElementType } from './elements/element-type';
import type { Vector2 } from './geometry';
import { catalogs, type MessageGetter } from './i18n/messages';
import { PageFrameAnchoring } from './page-frame/anchoring';
import type { ResolveMediaSrc } from './page-frame/pm/embed/renderer';
import type { ResolveNoteLink } from './page-frame/pm/markdown/note-links';
import { PlacementController } from './placement-controller';
import { Ruler } from './ruler';
import { SelectionController } from './selection-controller';
import type { LivePeersSnapshot } from './sync/live/peers';
import { createDefaultTools } from './tools/default-tool-registry';
import type { ITool, ToolId } from './tools/tool';
import type { YDocManager } from './ydoc-manager';

export type { Vector2 } from './geometry';
export type { ElementOrderItem, ElementReorderDirection };
export {
  canMoveElementOrderForSelection,
  coalescedPointerSamples,
  isStylusTouch,
  moveElementOrderForSelection,
};

export interface PlacementGhost {
  /** Bounds of the ghost rectangle, relative to the pointer's world position. */
  getBounds(): { x: number; y: number; width: number; height: number };
  /** Called when the user clicks to finalize placement. */
  onPlace(worldPos: Vector2): void;
}

const logger = new Logger('DrawableCanvas');

function unionBoundingBoxes(
  elements: readonly DrawableElement[],
): DOMRect | null {
  const boxes = elements
    .map((element) => element.boundingBox)
    .filter((box) => box.width > 0 || box.height > 0);
  if (boxes.length === 0) {
    return null;
  }
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export class DrawableCanvas {
  public readonly ctx: CanvasRenderingContext2D;
  public readonly viewport: CanvasViewport;
  public readonly tools: ITool[];
  public readonly ruler = new Ruler();

  private readonly renderer: CanvasRenderer;
  private readonly documentBinding: CanvasDocumentBinding;
  private readonly elementFactory: CanvasElementFactory;
  private readonly interaction: CanvasInteractionController;
  private readonly selection: SelectionController;
  private readonly editSession: EditSessionController;
  private readonly placement = new PlacementController();
  private readonly changeListeners = new Set<() => void>();
  private readonly frameListeners = new Set<() => void>();
  private redrawScheduler: (() => void) | null = null;
  private readonly handleDocUpdate = () => this.requestRedraw();
  private contentBoundsCache: DOMRect | null = null;
  private contentBoundsValid = false;
  private lastBookmarkId: string | null = null;
  private toolSelected: ITool;

  public constructor(
    canvas: HTMLCanvasElement,
    ydoc: YDocManager,
    tools?: ITool[],
    resolveNoteLink?: ResolveNoteLink,
    resolveMedia?: ResolveMediaSrc,
    private readonly localPeerIdValue = '',
    private readonly audioRecordingOwnerId = '',
    private readonly onAudioRecordingSaved:
      | (() => void | Promise<void>)
      | undefined = undefined,
    uiServices?: CanvasUiServices,
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      logger.error('Failed to get canvas context');
    }
    this.ctx = ctx!;
    this.renderer = new CanvasRenderer(
      this.ctx,
      canvas,
      () => this.requestRedraw(),
      ydoc.doc,
    );
    this.viewport = new CanvasViewport(canvas);
    this.viewport.onViewChange(() => this.requestRedraw());
    this.tools = tools ?? DrawableCanvas.makeTools(() => catalogs.en);
    this.toolSelected = this.tools[0];
    this.elementFactory = new CanvasElementFactory({
      ydoc,
      getElements: () => this.elements,
      getZoom: () => this.viewport.zoom,
      onChange: () => this.notifyChange(),
      invalidateContentBounds: () => this.invalidateContentBounds(),
      requestRedraw: () => this.requestRedraw(),
      resolveNoteLink,
      resolveMedia,
      localPeerId: this.localPeerIdValue,
      audioRecordingOwnerId: this.audioRecordingOwnerId,
      onAudioRecordingSaved: this.onAudioRecordingSaved,
      uiServices,
    });
    this.documentBinding = new CanvasDocumentBinding({
      ydoc,
      createElementFromYMap: (yMap) => this.elementFactory.createFromYMap(yMap),
      initializeElement: (element, yMap) =>
        this.elementFactory.initialize(element, yMap),
      onChange: () => this.notifyChange(),
      onRemoteChange: () => this.invalidateContentBounds(),
      onElementRemoved: (element) => this.elementFactory.dispose(element),
    });
    this.selection = new SelectionController(() => this.elements);
    this.editSession = new EditSessionController({
      drawableCanvas: this,
      canvas,
      viewport: this.viewport,
      getElements: () => this.elements,
      getActiveToolId: () => this.toolSelected.id,
      clearSelection: () => this.clearSelection(),
      beginToolInteraction: (event) =>
        this.interaction.startToolInteraction(event),
      notifyChange: () => this.notifyChange(),
    });
    this.interaction = new CanvasInteractionController({
      drawableCanvas: this,
      canvas,
      viewport: this.viewport,
      getActiveTool: () => this.toolSelected,
      setActiveTool: (tool) => {
        this.toolSelected = tool;
      },
      getTools: () => this.tools,
      clearSelection: () => this.clearSelection(),
      stopUndoCapturing: () => ydoc.undoManager.stopCapturing(),
      isPlacementActive: () => this.placement.isActive,
      placeAt: (position) => this.placement.ghost?.onPlace(position),
      endPlacement: () => this.endPlacement(),
      enterEditAtPoint: (point, event) => this.enterEditAtPoint(point, event),
      refreshRendererSize: () => this.renderer.refreshSize(),
    });
    this.viewport.setContentBoundsProvider(() => this.getContentBounds());
    this.viewport.setTouchSuppressedProvider(
      () => this.interaction.palmSuppressed,
    );
    this.documentBinding.hydrate();
    // Local and remote edits alike, including page-frame text, which lives in the same doc.
    ydoc.doc.on('update', this.handleDocUpdate);
  }

  public get ydoc(): YDocManager {
    return this.documentBinding.ydocManager;
  }

  public get localPeerId(): string {
    return this.localPeerIdValue;
  }

  public setLivePeers(snapshot: LivePeersSnapshot | null): void {
    this.elementFactory.setLivePeers(snapshot);
    this.requestRedraw();
  }

  public transact(fn: () => void): void {
    this.documentBinding.transact(fn);
  }

  public onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Schedules a frame; calls before the next frame coalesce into it. */
  public requestRedraw(): void {
    this.redrawScheduler?.();
  }

  // Installed by the render loop. Requests made while none is installed are dropped; the loop draws
  // a first frame when it starts.
  public setRedrawScheduler(scheduler: (() => void) | null): void {
    this.redrawScheduler = scheduler;
  }

  /** Runs after each redraw, in the same frame, for DOM layers positioned against the viewport. */
  public onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener);
    this.requestRedraw();
    return () => this.frameListeners.delete(listener);
  }

  public setOnPageFrameRenamed(
    callback?: (uuid: string, newName: string, oldName: string) => void,
  ): void {
    this.elementFactory.setOnPageFrameRenamed(callback);
  }

  public setBackgroundHost(host: HTMLElement): void {
    this.renderer.setBackgroundHost(host);
  }

  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.renderer.setOverlayCanvas(canvas);
  }

  public setDomOverlayHost(host: HTMLElement): void {
    this.editSession.setDomOverlayHost(host);
  }

  public setOnElementEdit(
    callback: (element: DrawableElement | null) => void,
  ): void {
    this.editSession.setOnElementEdit(callback);
  }

  public setOnToolSwitched(callback: (index: number) => void): void {
    this.interaction.setOnToolSwitched(callback);
  }

  public setOnPlacementEnd(callback: (() => void) | undefined): void {
    this.placement.setOnPlacementEnd(callback);
  }

  public get isPlacing(): boolean {
    return this.placement.isActive;
  }

  public startPlacement(ghost: PlacementGhost): void {
    if (this.editSession.element) {
      this.exitElementEdit();
    }
    if (this.placement.isActive) {
      this.endPlacement();
    }
    this.placement.start(ghost);
    this.interaction.setToolCursor('copy');
    this.notifyChange();
  }

  public cancelPlacement(): void {
    if (this.placement.isActive) {
      this.endPlacement();
    }
  }

  public getElementsByType(type: ElementType): DrawableElement[] {
    return this.elements.filter((element) => element.type === type);
  }

  public focusPageFrameByName(displayName: string): boolean {
    return this.focusFrameElement(
      this.selection.findPageFrameByName(displayName),
    );
  }

  public focusPageFrameById(uuid: string): boolean {
    return this.focusFrameElement(this.selection.findPageFrameById(uuid));
  }

  /** Flags in reading order: top to bottom, then left to right. */
  public get bookmarks(): BookmarkElement[] {
    return this.elements
      .filter((element) => element instanceof BookmarkElement)
      .sort((a, b) => a.offset.y - b.offset.y || a.offset.x - b.offset.x);
  }

  // Centers the flag, zooming in to at least 100% so the marked spot is legible.
  public focusBookmark(uuid: string): boolean {
    const flag = this.elements.find(
      (element) => element instanceof BookmarkElement && element.uuid === uuid,
    );
    if (!flag) {
      return false;
    }
    this.lastBookmarkId = uuid;
    const view = this.viewport.getWorldRect();
    const scale = this.viewport.zoom / Math.max(this.viewport.zoom, 1);
    const width = view.width * scale;
    const height = view.height * scale;
    this.viewport.animateViewToFitRect(
      new DOMRect(
        flag.offset.x - width / 2,
        flag.offset.y - height / 2,
        width,
        height,
      ),
      1,
    );
    return true;
  }

  public stepBookmark(direction: 1 | -1): void {
    const flags = this.bookmarks;
    if (flags.length === 0) {
      return;
    }
    const current = flags.findIndex(
      (flag) => flag.uuid === this.lastBookmarkId,
    );
    const next =
      current === -1
        ? direction === 1
          ? 0
          : flags.length - 1
        : (current + direction + flags.length) % flags.length;
    this.focusBookmark(flags[next].uuid);
  }

  public get editingElement(): DrawableElement | null {
    return this.editSession.element;
  }

  public get isCanvasInteractiveEditMode(): boolean {
    return this.editSession.isCanvasInteractive;
  }

  public syncViewportEditModePan(): void {
    this.editSession.syncViewportEditModePan();
  }

  public enterElementEdit(element: DrawableElement, event?: Event): void {
    this.editSession.enter(element, event);
  }

  public exitElementEdit(): void {
    this.editSession.exit();
  }

  public enterEditAtPoint(point: Vector2, event?: Event): boolean {
    return this.editSession.enterAtPoint(point, event);
  }

  public destroy(): void {
    this.ydoc.doc.off('update', this.handleDocUpdate);
    this.frameListeners.clear();
    this.editSession.destroy();
    if (this.placement.isActive) {
      this.endPlacement();
    }
    this.interaction.destroy();
    this.renderer.destroy();
    this.documentBinding.destroy();
    this.viewport.destroy();
  }

  public readonly anchoring = new PageFrameAnchoring(this, () =>
    this.notifyChange(),
  );

  /** Returns whether an animation needs the next frame even if nothing requests one. */
  public redraw(deltaTime: number): boolean {
    this.anchoring.refresh();
    const animating = this.renderer.redraw(
      deltaTime,
      this.viewport,
      this.elements,
      this.editSession.element,
      this.interaction.selectedTool,
      this.interaction.cursorPosition,
      this.placement,
      this.editSession.domHost,
      this.selection,
      this.ruler,
    );
    for (const listener of this.frameListeners) {
      listener();
    }
    return animating;
  }

  // `null` when empty — the viewport reads that as "no clamp" so fresh documents stay pannable.
  public getContentBounds(): DOMRect | null {
    if (!this.contentBoundsValid) {
      this.contentBoundsCache = unionBoundingBoxes(this.elements);
      this.contentBoundsValid = true;
    }
    return this.contentBoundsCache;
  }

  public get contentBounds(): DOMRect {
    return (
      unionBoundingBoxes(this.elements.filter((element) => !element.hidden)) ??
      new DOMRect(0, 0, 0, 0)
    );
  }

  public get elements(): DrawableElement[] {
    return this.documentBinding.elements;
  }

  public getElementByUuid(uuid: string): DrawableElement | null {
    return this.documentBinding.getElementByUuid(uuid);
  }

  public getSelectedElements(): DrawableElement[] {
    return this.selection.selectedElements;
  }

  public getSelectedElementBounds(): DOMRect | null {
    return this.selection.getBounds();
  }

  public getSelectedElementScreenBounds(): DOMRect | null {
    return this.selection.getScreenBounds(this.viewport);
  }

  public getSelectionInteractionBounds(pointerType: string): DOMRect | null {
    return this.selection.getInteractionBounds(this.viewport.zoom, pointerType);
  }

  public hitSelectionHandle(
    point: Vector2,
    pointerType: string,
  ): ResizeHandle | null {
    return this.selection.hitHandle(point, this.viewport.zoom, pointerType);
  }

  public shouldUseSelectToolForTouch(point: Vector2): boolean {
    return this.selection.shouldUseSelectToolForTouch(
      point,
      this.viewport.zoom,
    );
  }

  public canReorderSelection(direction: ElementReorderDirection): boolean {
    return this.documentBinding.canReorder(
      this.selection.selectedElements.map((element) => element.uuid),
      direction,
    );
  }

  public reorderSelection(direction: ElementReorderDirection): boolean {
    return this.documentBinding.reorder(
      this.selection.selectedElements.map((element) => element.uuid),
      direction,
    );
  }

  public clearSelection(): void {
    this.selection.clear();
  }

  public selectElementsByUuid(uuids: readonly string[]): void {
    this.selection.selectByUuid(uuids);
  }

  public selectAllElements(): void {
    if (this.editSession.element || this.placement.isActive) {
      return;
    }
    this.selection.selectAll();
  }

  public insertElementMap(
    yMap: Y.Map<unknown>,
    options?: { background?: boolean; position?: number },
  ): DrawableElement | null {
    return this.documentBinding.insertElementMap(yMap, options);
  }

  public addElement<T extends DrawableElement>(
    factory: (uuid: string) => T,
    positionOverride?: number,
  ): T {
    return this.documentBinding.addElement(factory, positionOverride);
  }

  public removeElement(element: DrawableElement): void {
    this.documentBinding.removeElement(element);
  }

  public deleteSelected(): void {
    if (this.editSession.element) {
      return;
    }
    this.documentBinding.deleteElements(this.selection.selectedElements);
  }

  public setRulerVisible(visible: boolean): void {
    if (visible) {
      this.ruler.show(this.viewport.getWorldRect());
    } else {
      this.ruler.hide();
    }
    this.requestRedraw();
  }

  public setCursor(cursor: string): void {
    this.interaction.setToolCursor(cursor);
  }

  public get penIsErasing(): boolean {
    return this.interaction.penIsErasing;
  }

  public abortInteraction(): void {
    this.interaction.abortInteraction();
  }

  public releaseTouchForToolWheel(): boolean {
    return this.interaction.releaseTouchForToolWheel();
  }

  public switchTool(index: number): void {
    this.interaction.switchTool(index);
  }

  public switchToTool(id: ToolId): void {
    this.interaction.switchToTool(id);
  }

  public setSpaceDown(value: boolean): void {
    this.interaction.setSpaceDown(value);
  }

  public undo(): void {
    this.ydoc.undoManager.undo();
  }

  public redo(): void {
    this.ydoc.undoManager.redo();
  }

  public static makeTools(getStrings: MessageGetter): ITool[] {
    return createDefaultTools(getStrings);
  }

  private notifyChange(): void {
    this.invalidateContentBounds();
    this.requestRedraw();
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  private invalidateContentBounds(): void {
    this.contentBoundsValid = false;
  }

  private endPlacement(): void {
    this.placement.end();
    this.interaction.setToolCursor('default');
    this.notifyChange();
  }

  private focusFrameElement(element: DrawableElement | null): boolean {
    if (!element) {
      return false;
    }
    if (this.editSession.element && this.editSession.element !== element) {
      this.exitElementEdit();
    }
    this.clearSelection();
    element.select();
    this.viewport.animateViewToFitRect(element.boundingBox, {
      widthRatio: 0.72,
      heightRatio: 0.82,
    });
    return true;
  }
}
