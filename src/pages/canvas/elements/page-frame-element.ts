import {
  Columns3 as ColumnsIcon,
  GalleryVertical as ContinuousIcon,
  Download as DownloadIcon,
  Rows3 as RowsIcon,
} from 'lucide-react';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type * as Y from 'yjs';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { exportPdf as exportPdfToRust } from '@/lib/pdf-export/client';
import { UserPrefs } from '@/lib/user-prefs';
import type { ChromeMenuItem } from '../chrome-menu';
import type { DrawableCanvas } from '../drawable-canvas';
import {
  type ExportOptions,
  type ExportResult,
  type ExportTarget,
  openExportDialog,
} from '../export/export-controller';
import { serializeDocToMarkdownChunked } from '../page-frame/markdown-serializer';
import { harvestPageFramePdf } from '../page-frame/page-frame-harvest';
import { PageFrameEditorState } from '../page-frame/pm/editor-state';
import type { ResolveNoteLink as NoteLinkResolver } from '../page-frame/pm/markdown/note-links';
import { schema } from '../page-frame/pm/schema';
import { renderPageFrameThumbnail } from '../page-frame/thumbnail/render';
import type { YDocManager } from '../ydoc-manager';
import {
  DrawableElement,
  type ResizeHandle,
  ResizeHandles,
} from './drawable-element';
import { ElementType } from './element-type';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
} from './frame-chrome';
import {
  DEFAULT_PAGE_FRAME_DISPLAY_NAME,
  normalizePageFrameDisplayName,
  PAGE_CORNER_RADIUS,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_PADDING,
  PAGE_WIDTH,
  type PageLayout,
} from './page-frame-constants';

export {
  PAGE_CORNER_RADIUS,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_PADDING,
  PAGE_WIDTH,
} from './page-frame-constants';

const MIN_PAGE_WIDTH = 240;
const EDIT_MODE_WIDTH_RATIO = 0.65;
const EDIT_MODE_HEIGHT_RATIO = 0.86;

export class PageFrameElement extends DrawableElement {
  private _pageWidth = PAGE_WIDTH;
  private _pageHeight = PAGE_HEIGHT;
  private _displayName: string;
  private _pageLayout: PageLayout;
  private _editing = false;
  private _numPages = 1;
  /**
   * Natural editor content height (CSS px), reported by the pagination plugin
   * while in `continuous` layout. `null` in paginated/column layouts, where the
   * frame's height is derived from page math instead.
   */
  private _measuredContentHeight: number | null = null;
  private _exportElementsProvider: (() => readonly DrawableElement[]) | null =
    null;
  private _noteLinkResolver?: NoteLinkResolver;
  private _onDisplayNameRenamed?: (
    uuid: string,
    newName: string,
    oldName: string,
  ) => void;

  /** Set externally by DrawableCanvas after binding to Y.Doc. */
  private _yXmlFragment: Y.XmlFragment | null = null;
  public pmEditor: PageFrameEditorState | null = null;

  private _frameDiv: HTMLDivElement | null = null;
  private _contentDiv: HTMLDivElement | null = null;

  public get frameDiv(): HTMLDivElement | null {
    return this._frameDiv;
  }
  public get contentDiv(): HTMLDivElement | null {
    return this._contentDiv;
  }

  public mountDOM(frameDiv: HTMLDivElement, contentDiv: HTMLDivElement): void {
    this._frameDiv = frameDiv;
    this._contentDiv = contentDiv;
  }

  constructor(
    uuid: string,
    displayName?: string,
    pageLayout: PageLayout = 'vertical',
  ) {
    super(uuid, ElementType.PAGE_FRAME);
    this._displayName = displayName ?? DEFAULT_PAGE_FRAME_DISPLAY_NAME;
    this._pageLayout = pageLayout;
  }

  public setNoteLinkResolver(resolveNoteLink?: NoteLinkResolver): void {
    this._noteLinkResolver = resolveNoteLink;
  }

  public setOnDisplayNameRenamed(
    callback?: (uuid: string, newName: string, oldName: string) => void,
  ): void {
    this._onDisplayNameRenamed = callback;
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.HorizontalSides;
  }

  private _resizeOriginalPageWidth: number = PAGE_WIDTH;

  public override beginResize(): void {
    this._resizeOriginalPageWidth = this._pageWidth;
  }

  public override applyResize(opts: {
    handle: ResizeHandle;
    originalScale: { x: number; y: number };
    originalOffset: { x: number; y: number };
    ratioX: number;
    ratioY: number;
    anchorWorld: { x: number; y: number };
  }): void {
    const { handle: h, originalOffset, ratioX, anchorWorld } = opts;
    if (!h.scaleX) {
      return;
    }

    const newWidth = Math.max(
      MIN_PAGE_WIDTH,
      this._resizeOriginalPageWidth * ratioX,
    );
    if (newWidth !== this._pageWidth) {
      this._pageWidth = newWidth;
      this.syncToYMap({ pageWidth: newWidth });
    }

    // _scale stays at 1, so re-derive offset without a scale multiplier.
    // Anchor side of the frame (incl. chrome padding) must stay at anchorWorld.
    const local = this.localBoundingBox;
    const localAnchorX = local.x + local.width * h.anchorFx;
    const newOffsetX = anchorWorld.x - h.anchorPad.x - localAnchorX;
    this.setOffset(newOffsetX, originalOffset.y);
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      displayName: this._displayName,
      pageWidth: this._pageWidth,
      pageHeight: this._pageHeight,
      pageLayout: this._pageLayout,
    };
  }

  /** Bind Yjs shared types. Must be called after bindToYMap. */
  private bindYProseMirror(yXmlFragment: Y.XmlFragment): void {
    this._yXmlFragment = yXmlFragment;
    this.pmEditor = new PageFrameEditorState(
      yXmlFragment,
      this._noteLinkResolver,
    );
  }

  public get yXmlFragment(): Y.XmlFragment | null {
    return this._yXmlFragment;
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      displayName: (v) => {
        this._displayName = normalizePageFrameDisplayName(v);
      },
      pageWidth: (v) => {
        this._pageWidth = v as number;
      },
      pageHeight: (v) => {
        this._pageHeight = v as number;
      },
      pageLayout: (v) => {
        this._pageLayout =
          v === 'horizontal' || v === 'continuous' ? v : 'vertical';
      },
    });
  }

  public get editing(): boolean {
    return this._editing;
  }
  public get pageWidth(): number {
    return this._pageWidth;
  }
  public get pageHeight(): number {
    return this._pageHeight;
  }
  public get displayName(): string {
    return this._displayName;
  }
  public get pageLayout(): PageLayout {
    return this._pageLayout;
  }
  public setDisplayName(displayName: string): void {
    const next = normalizePageFrameDisplayName(displayName);
    const previous = this._displayName;
    if (next === previous) {
      return;
    }
    this._displayName = next;
    this.syncToYMap({ displayName: next });
    this._onDisplayNameRenamed?.(this.uuid, next, previous);
  }
  public setPageLayout(pageLayout: PageLayout): void {
    if (pageLayout === this._pageLayout) {
      return;
    }
    this._pageLayout = pageLayout;
    this.syncToYMap({ pageLayout });
  }
  public get numPages(): number {
    return this._numPages;
  }
  public set numPages(n: number) {
    this._numPages = n;
  }
  /**
   * Record the editor's natural content height for `continuous` layout. Pass
   * `null` from paginated/column layouts so the geometry getters fall back to
   * page math.
   */
  public setMeasuredContentHeight(height: number | null): void {
    this._measuredContentHeight = height;
  }

  public get totalWidth(): number {
    const n = this._numPages;
    if (this._pageLayout === 'horizontal') {
      return n * this._pageWidth + Math.max(0, n - 1) * PAGE_GAP;
    }
    return this._pageWidth;
  }

  public get totalHeight(): number {
    const n = this._numPages;
    if (this._pageLayout === 'horizontal') {
      return this._pageHeight;
    }
    if (this._pageLayout === 'continuous') {
      return this.continuousStripHeight(this._measuredContentHeight);
    }
    return n * this._pageHeight + Math.max(0, n - 1) * PAGE_GAP;
  }

  /**
   * Height of a continuous (single-sheet) frame: as tall as the content plus
   * the page's top and bottom padding, but never shorter than a single page so
   * an empty frame still reads as a page. `content` is the editor's natural
   * height (CSS px), or `null` if it hasn't been measured yet.
   */
  private continuousStripHeight(content: number | null): number {
    return Math.max(this._pageHeight, (content ?? 0) + PAGE_PADDING * 2);
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(
      -CHROME_SIDE_PADDING,
      -CHROME_HEADER_HEIGHT,
      this.totalWidth + CHROME_SIDE_PADDING * 2,
      this.totalHeight + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
    );
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    // Chrome (surrounding frame + header) hit area
    if (
      x >= -CHROME_SIDE_PADDING &&
      x <= this.totalWidth + CHROME_SIDE_PADDING &&
      y >= -CHROME_HEADER_HEIGHT &&
      y <= this.totalHeight + CHROME_BOTTOM_PADDING
    ) {
      return true;
    }
    for (let p = 0; p < this._numPages; p++) {
      const pageLeft =
        this._pageLayout === 'horizontal'
          ? p * (this._pageWidth + PAGE_GAP)
          : 0;
      const pageTop =
        this._pageLayout === 'horizontal'
          ? 0
          : p * (this._pageHeight + PAGE_GAP);
      if (
        x >= pageLeft &&
        x <= pageLeft + this._pageWidth &&
        y >= pageTop &&
        y <= pageTop + this._pageHeight
      ) {
        return true;
      }
    }
    return false;
  }

  protected updateBoundingBox(): void {}

  public override get editable(): boolean {
    return true;
  }

  public override get lowersCanvasWhileEditing(): boolean {
    return true;
  }

  public override bindSharedYState(ydoc: YDocManager): void {
    this.bindYProseMirror(ydoc.getXmlFragment(this.uuid));
  }

  public override enterEditMode(
    canvas: DrawableCanvas,
    screenX?: number,
    screenY?: number,
  ): HTMLElement | null {
    this._editing = true;
    this.pmEditor?.setEditable(true);

    if (UserPrefs.get('pageFrameEditFitWholePage')) {
      const sx = Math.abs(this._scale.x);
      const sy = Math.abs(this._scale.y);
      const focusWorld =
        screenX != null && screenY != null
          ? canvas.viewport.screenToWorld({ x: screenX, y: screenY })
          : {
              x: this.offset.x + (this._pageWidth * sx) / 2,
              y: this.offset.y + (this._pageHeight * sy) / 2,
            };
      let pageLeft: number;
      let pageTop: number;
      if (this._pageLayout === 'continuous') {
        // No discrete pages to snap to: frame a page-height window centered on
        // the cursor, clamped to the strip.
        pageLeft = 0;
        const localFocusY = (focusWorld.y - this.offset.y) / sy;
        pageTop = Math.max(
          0,
          Math.min(
            localFocusY - this._pageHeight / 2,
            this.totalHeight - this._pageHeight,
          ),
        );
      } else {
        const pageStride =
          this._pageLayout === 'horizontal'
            ? this._pageWidth + PAGE_GAP
            : this._pageHeight + PAGE_GAP;
        const localFocus =
          this._pageLayout === 'horizontal'
            ? (focusWorld.x - this.offset.x) / sx
            : (focusWorld.y - this.offset.y) / sy;
        const pageIndex = Math.min(
          Math.max(0, this._numPages - 1),
          Math.max(0, Math.floor(localFocus / pageStride)),
        );
        pageLeft =
          this._pageLayout === 'horizontal' ? pageIndex * pageStride : 0;
        pageTop =
          this._pageLayout === 'horizontal' ? 0 : pageIndex * pageStride;
      }
      const focusRect = new DOMRect(
        this.offset.x + pageLeft * sx,
        this.offset.y + pageTop * sy,
        this._pageWidth * sx,
        this._pageHeight * sy,
      );
      canvas.viewport.animateViewToFitRect(focusRect, {
        widthRatio: EDIT_MODE_WIDTH_RATIO,
        heightRatio: EDIT_MODE_HEIGHT_RATIO,
      });
    }

    const view = this.pmEditor?.view;
    if (view) {
      // Resolve click position BEFORE focus — focus may scroll the
      // container, which would invalidate the viewport coordinates.
      let pos: number | null = null;
      if (screenX != null && screenY != null) {
        const coords = view.posAtCoords({ left: screenX, top: screenY });
        if (coords) {
          pos = coords.pos;
        }
      }
      if (pos == null) {
        pos = view.state.doc.content.size - 1;
      }

      view.focus();
      const tr = view.state.tr.setSelection(
        Selection.near(view.state.doc.resolve(pos)),
      );
      view.dispatch(tr);
    }

    requestAnimationFrame(() => {
      if (this._editing) {
        this.pmEditor?.ensureFocused();
      }
    });

    return this.frameDiv;
  }

  public ensureEditorFocused(): void {
    if (this._editing) {
      this.pmEditor?.ensureFocused();
    }
  }

  public override exitEditMode(): void {
    this._editing = false;
    this.pmEditor?.clearSelection();
    this.pmEditor?.setEditable(false);
    this.pmEditor?.blur();
    // Yjs UndoManager captures PM changes automatically — no snapshot needed
  }

  public getMenuItems(): ChromeMenuItem[] {
    return [
      {
        id: 'layout-vertical',
        label: 'Pages',
        icon: RowsIcon,
        checked: this._pageLayout === 'vertical',
        onSelect: () => this.setPageLayout('vertical'),
      },
      {
        id: 'layout-continuous',
        label: 'Continuous',
        icon: ContinuousIcon,
        checked: this._pageLayout === 'continuous',
        onSelect: () => this.setPageLayout('continuous'),
      },
      {
        id: 'layout-horizontal',
        label: 'Columns',
        icon: ColumnsIcon,
        checked: this._pageLayout === 'horizontal',
        onSelect: () => this.setPageLayout('horizontal'),
      },
      {
        id: 'export',
        label: 'Export',
        icon: DownloadIcon,
        onSelect: () => openExportDialog(this.buildExportTarget()),
      },
    ];
  }

  private buildExportTarget(): ExportTarget {
    return {
      title: this._displayName || DEFAULT_PAGE_FRAME_DISPLAY_NAME,
      formats: ['pdf', 'markdown'],
      supportsAnnotations: true,
      run: (options) => this.runExport(options),
    };
  }

  private runExport({
    format,
    includeAnnotations,
  }: ExportOptions): Promise<ExportResult> {
    return format === 'markdown'
      ? this.runMarkdownExport()
      : this.runPdfExport(includeAnnotations);
  }

  /** Sanitize the display name into a filesystem-safe export filename stem. */
  private getSafeExportName(): string {
    return (
      [...this._displayName]
        .map((char) =>
          char.charCodeAt(0) <= 0x1f || '/\\:*?"<>|'.includes(char)
            ? '-'
            : char,
        )
        .join('')
        .trim() || DEFAULT_PAGE_FRAME_DISPLAY_NAME
    );
  }

  private async runMarkdownExport(): Promise<ExportResult> {
    const view = this.pmEditor?.view;
    if (!view) {
      return {};
    }
    // Kick off serialization in the background — it runs in chunked async
    // batches that yield to the event loop, so the save dialog animation
    // and menu close both paint smoothly while the doc is processed.
    const mdPromise = serializeDocToMarkdownChunked(view.state.doc);
    const path = await save({
      defaultPath: `${this.getSafeExportName()}.md`,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (!path) {
      return { cancelled: true };
    }
    const md = await mdPromise;
    await writeTextFile(path, md);
    return {};
  }

  private async runPdfExport(
    includeAnnotations: boolean,
  ): Promise<ExportResult> {
    const contentDiv = this.contentDiv;
    if (!contentDiv) {
      return {};
    }
    const path = await save({
      defaultPath: `${this.getSafeExportName()}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!path) {
      return { cancelled: true };
    }
    // Continuous frames have no page breaks: harvest them as a single page
    // sized to the whole strip (krilla allows an arbitrarily tall page), which
    // matches what's on screen exactly. Measure the editor's live height here
    // rather than reading the cached `totalHeight` — the cache is only kept
    // fresh by the pagination rAF loop, so a freshly-mounted frame could still
    // report `null` and collapse the export box to a single page.
    const continuous = this._pageLayout === 'continuous';
    const editorDom = this.pmEditor?.view?.dom;
    const pageHeight = continuous
      ? this.continuousStripHeight(
          editorDom instanceof HTMLElement ? editorDom.offsetHeight : null,
        )
      : this._pageHeight;
    const { request, warnings } = await harvestPageFramePdf({
      contentDiv,
      numPages: continuous ? 1 : this._numPages,
      pageWidth: this._pageWidth,
      pageHeight,
      pageLayout: this._pageLayout === 'horizontal' ? 'horizontal' : 'vertical',
      offset: { x: this.offset.x, y: this.offset.y },
      selfUuid: this.uuid,
      overlays: includeAnnotations
        ? (this._exportElementsProvider?.() ?? [])
        : undefined,
    });
    await exportPdfToRust(request, path);
    return { warnings };
  }

  public setExportElementsProvider(
    provider: () => readonly DrawableElement[],
  ): void {
    this._exportElementsProvider = provider;
  }

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

  /**
   * Resolve the current ProseMirror doc for thumbnailing: prefer the live editor
   * doc while editing, otherwise convert the Y.XmlFragment with the same helper
   * the editor uses. Returns `null` if there's no content to draw.
   */
  private getThumbnailDoc(): ProseMirrorNode | null {
    const liveDoc = this.pmEditor?.view?.state.doc;
    if (liveDoc) {
      return liveDoc;
    }
    const fragment = this._yXmlFragment;
    if (!fragment || fragment.length === 0) {
      return null;
    }
    return yXmlFragmentToProseMirrorRootNode(fragment, schema);
  }

  /**
   * Paint the first page's white background and the document text into the
   * off-screen thumbnail context. Runs in element-local coordinates (origin at
   * the top-left of page 0), matching `drawThumbnail`'s caller transform.
   */
  public override drawThumbnail(
    ctx: CanvasRenderingContext2D,
    _deltaTime: number,
  ): void {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(0, 0, this._pageWidth, this._pageHeight, PAGE_CORNER_RADIUS);
    ctx.fill();

    const doc = this.getThumbnailDoc();
    if (!doc) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this._pageWidth, this._pageHeight);
    ctx.clip();
    ctx.translate(PAGE_PADDING, PAGE_PADDING);
    renderPageFrameThumbnail(doc, ctx, {
      width: this._pageWidth - PAGE_PADDING * 2,
      maxHeight: this._pageHeight - PAGE_PADDING * 2,
    });
    ctx.restore();
  }
}
