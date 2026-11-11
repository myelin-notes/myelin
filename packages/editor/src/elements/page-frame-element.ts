import {
  Type as BodyTextIcon,
  GalleryVertical as ContinuousIcon,
  Download as DownloadIcon,
  Square as MarginsIcon,
  Hash as PageNumbersIcon,
  FileText as PageSizeIcon,
  Rows3 as RowsIcon,
} from 'lucide-react';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type * as Y from 'yjs';
import { trackEvent } from '@myelin/shared/analytics';
import { getCanvasPalette } from '../canvas-theme';
import type { ChromeMenuItem } from '../chrome-menu';
import type { DrawableCanvas } from '../drawable-canvas';
import type {
  ExportOptions,
  ExportResult,
  ExportTarget,
} from '../export/export-controller';
import { getMessages } from '../i18n';
import {
  CONTENT_FORMAT_KEY,
  migrateLegacyPageFrameContent,
  PAGE_FRAME_CONTENT_FORMAT,
} from '../page-frame/markdown/legacy-content';
import { serializeDocToMarkdownChunked } from '../page-frame/markdown/serializer';
import {
  harvestPageFramePdf,
  type PageFramePdfSource,
} from '../page-frame/page-frame-harvest';
import { PageFrameEditorState } from '../page-frame/pm/editor-state';
import {
  pinEmbedHosts,
  type ResolveMediaSrc,
} from '../page-frame/pm/embed/renderer';
import type { ResolveNoteLink as NoteLinkResolver } from '../page-frame/pm/markdown/note-links';
import type { PageGeometry } from '../page-frame/pm/pagination/core';
import { schema } from '../page-frame/pm/schema';
import { renderPageFrameThumbnail } from '../page-frame/thumbnail/render';
import {
  type PdfExportOverlayElement,
  prepareExportOverlays,
} from '../pdf-element-export';
import { getPlatform } from '../platform';
import { UserPrefs } from '../user-prefs';
import type { YDocManager } from '../ydoc-manager';
import type {
  CanvasElementContext,
  CanvasUiServices,
} from './canvas-element-context';
import type {
  CanvasSearchContent,
  SearchableElement,
} from './canvas-searchable-element';
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
} from './frame/chrome';
import {
  BODY_FONT_PT_OPTIONS,
  DEFAULT_BODY_FONT_PT,
  DEFAULT_PAGE_FRAME_DISPLAY_NAME,
  normalizePageFrameDisplayName,
  normalizePageFrameLayout,
  normalizePagePreset,
  PAGE_CORNER_RADIUS,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_MARGIN_OPTIONS,
  PAGE_PADDING,
  PAGE_PRESET_MARGIN,
  PAGE_PRESETS,
  PAGE_WIDTH,
  type PageFrameLayout,
  type PageLayout,
  type PagePreset,
} from './page-frame-constants';
import type {
  CanvasPdfExportData,
  PdfExportableElement,
} from './pdf-exportable-element';

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

function nextOption<T extends number>(
  options: readonly T[],
  current: number,
): T {
  return options[(options.indexOf(current as T) + 1) % options.length];
}

export class PageFrameElement
  extends DrawableElement
  implements PdfExportableElement, SearchableElement
{
  private _pageWidth = PAGE_WIDTH;
  private _pageHeight = PAGE_HEIGHT;
  private _pageMargin: number = PAGE_PADDING;
  // `null` is a free-form page: frames from before paper sizes, or ones dragged to a custom width.
  private _pagePreset: PagePreset | null = null;
  private _showPageNumbers = false;
  private _bodyFontPt: number = DEFAULT_BODY_FONT_PT;
  private _displayName: string;
  private _pageLayout: PageFrameLayout;
  private _editing = false;
  private _numPages = 1;
  // Reported by the pagination plugin in `continuous` layout. `null` elsewhere, where the frame's
  // height comes from page math.
  private _measuredContentHeight: number | null = null;
  private _exportElementsProvider: (() => readonly DrawableElement[]) | null =
    null;
  private _noteLinkResolver?: NoteLinkResolver;
  private _mediaResolver?: ResolveMediaSrc;
  private _uiServices?: CanvasUiServices;
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
    this._pageLayout = normalizePageFrameLayout(pageLayout);
  }

  public setNoteLinkResolver(resolveNoteLink?: NoteLinkResolver): void {
    this._noteLinkResolver = resolveNoteLink;
  }

  public setMediaResolver(resolveMedia?: ResolveMediaSrc): void {
    this._mediaResolver = resolveMedia;
  }

  public setOnDisplayNameRenamed(
    callback?: (uuid: string, newName: string, oldName: string) => void,
  ): void {
    this._onDisplayNameRenamed = callback;
  }

  public override configureCanvas(context: CanvasElementContext): void {
    this.setNoteLinkResolver(context.resolveNoteLink);
    this.setMediaResolver(context.resolveMedia);
    this.setOnDisplayNameRenamed(context.onPageFrameRenamed);
    this.setExportElementsProvider(context.getElements);
    this._uiServices = context.uiServices;
  }

  public get uiServices(): CanvasUiServices | undefined {
    return this._uiServices;
  }

  public override get resizeHandles(): ResizeHandles {
    return this._pagePreset !== null && this._pageLayout === 'vertical'
      ? ResizeHandles.None
      : ResizeHandles.HorizontalSides;
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
      this._pagePreset = null;
      this.syncToYMap({ pageWidth: newWidth, pagePreset: null });
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
      pageMargin: this._pageMargin,
      pagePreset: this._pagePreset,
      showPageNumbers: this._showPageNumbers,
      bodyFontPt: this._bodyFontPt,
      [CONTENT_FORMAT_KEY]: PAGE_FRAME_CONTENT_FORMAT,
    };
  }

  /** Bind Yjs shared types. Must be called after bindToYMap. */
  private bindYProseMirror(yXmlFragment: Y.XmlFragment): void {
    this._yXmlFragment = yXmlFragment;
    this.pmEditor = new PageFrameEditorState(
      yXmlFragment,
      this._noteLinkResolver,
      this._mediaResolver,
      this._uiServices?.ensureCodeOutputCard,
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
        this._pageLayout = normalizePageFrameLayout(v);
      },
      pageMargin: (v) => {
        this._pageMargin = v as number;
      },
      pagePreset: (v) => {
        this._pagePreset = normalizePagePreset(v);
      },
      showPageNumbers: (v) => {
        this._showPageNumbers = v === true;
      },
      bodyFontPt: (v) => {
        this._bodyFontPt = v as number;
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
  public get pageMargin(): number {
    return this._pageMargin;
  }
  public get pagePreset(): PagePreset | null {
    return this._pagePreset;
  }
  public get showPageNumbers(): boolean {
    return this._showPageNumbers;
  }
  public get bodyFontPt(): number {
    return this._bodyFontPt;
  }
  public get pageGeometry(): PageGeometry {
    return {
      contentHeight: this._pageHeight - this._pageMargin * 2,
      breakGap: this._pageMargin * 2 + PAGE_GAP,
    };
  }
  public get displayName(): string {
    return this._displayName;
  }
  public get pageLayout(): PageFrameLayout {
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
  public setPageLayout(pageLayout: PageFrameLayout): void {
    if (pageLayout === this._pageLayout) {
      return;
    }
    this._pageLayout = pageLayout;
    this.syncToYMap({ pageLayout });
  }
  public setPagePreset(preset: PagePreset): void {
    if (preset === this._pagePreset) {
      return;
    }
    const { width, height } = PAGE_PRESETS[preset];
    const pageMargin =
      this._pagePreset === null ? PAGE_PRESET_MARGIN : this._pageMargin;
    this._pagePreset = preset;
    this._pageWidth = width;
    this._pageHeight = height;
    this._pageMargin = pageMargin;
    this.syncToYMap({
      pagePreset: preset,
      pageWidth: width,
      pageHeight: height,
      pageMargin,
    });
    this.onRedrawNeeded?.();
  }
  public cyclePageMargin(): void {
    this._pageMargin = nextOption(PAGE_MARGIN_OPTIONS, this._pageMargin);
    this.syncToYMap({ pageMargin: this._pageMargin });
    this.onRedrawNeeded?.();
  }
  public cycleBodyFontPt(): void {
    this._bodyFontPt = nextOption(BODY_FONT_PT_OPTIONS, this._bodyFontPt);
    this.syncToYMap({ bodyFontPt: this._bodyFontPt });
    this.onRedrawNeeded?.();
  }
  public setShowPageNumbers(show: boolean): void {
    this._showPageNumbers = show;
    this.syncToYMap({ showPageNumbers: show });
    this.onRedrawNeeded?.();
  }
  public get numPages(): number {
    return this._numPages;
  }
  public set numPages(n: number) {
    if (this._numPages === n) {
      return;
    }
    this._numPages = n;
    this.onRedrawNeeded?.();
  }
  // Pass `null` from paginated layouts so the geometry getters fall back to page math.
  public setMeasuredContentHeight(height: number | null): void {
    if (this._measuredContentHeight === height) {
      return;
    }
    this._measuredContentHeight = height;
    this.onRedrawNeeded?.();
  }

  public get totalWidth(): number {
    return this._pageWidth;
  }

  public get totalHeight(): number {
    const n = this._numPages;
    if (this._pageLayout === 'continuous') {
      return this.continuousStripHeight(this._measuredContentHeight);
    }
    return n * this._pageHeight + Math.max(0, n - 1) * PAGE_GAP;
  }

  // Never shorter than a single page, so an empty frame still reads as a page. `content` is the
  // editor's natural height, or `null` if unmeasured.
  private continuousStripHeight(content: number | null): number {
    return Math.max(this._pageHeight, (content ?? 0) + this._pageMargin * 2);
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
      const pageTop = p * (this._pageHeight + PAGE_GAP);
      if (
        x >= 0 &&
        x <= this._pageWidth &&
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

  public override get locksViewportPanWhileEditing(): boolean {
    return true;
  }

  public override bindSharedYState(ydoc: YDocManager): void {
    const fragment = ydoc.getXmlFragment(this.uuid);
    if (this._yMap) {
      migrateLegacyPageFrameContent(this._yMap, fragment);
    }
    this.bindYProseMirror(fragment);
  }

  public override enterEditMode(
    canvas: DrawableCanvas,
    screenX?: number,
    screenY?: number,
  ): HTMLElement | null {
    const wasEditing = this._editing;
    this._editing = true;
    this.pmEditor?.setEditable(true);

    // The math source editor is loaded on demand, so whichever formula is clicked first pays for the
    // fetch — and the block only reveals its source panel once CodeMirror is attached, so that click
    // reads as a no-op until the module lands. Becoming editable is the earliest the panel could be
    // opened, and precedes the click by enough that openEditor takes its synchronous path. Failures
    // are ignored — the click path loads it again and reports there.
    void import('../page-frame/pm/math/source-editor')
      .then((module) => module.getSharedMathSourceEditor())
      .catch(() => {});

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
      let pageTop: number;
      if (this._pageLayout === 'continuous') {
        // No discrete pages to snap to: frame a page-height window centered on
        // the cursor, clamped to the strip.
        const localFocusY = (focusWorld.y - this.offset.y) / sy;
        pageTop = Math.max(
          0,
          Math.min(
            localFocusY - this._pageHeight / 2,
            this.totalHeight - this._pageHeight,
          ),
        );
      } else {
        const pageStride = this._pageHeight + PAGE_GAP;
        const localFocus = (focusWorld.y - this.offset.y) / sy;
        const pageIndex = Math.min(
          Math.max(0, this._numPages - 1),
          Math.max(0, Math.floor(localFocus / pageStride)),
        );
        pageTop = pageIndex * pageStride;
      }
      const focusRect = new DOMRect(
        this.offset.x,
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

    if (!wasEditing) {
      trackEvent('page_frame_edit_started', { page_layout: this._pageLayout });
    }

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
    const strings = getMessages().canvas.frame;
    return [
      {
        id: 'layout-vertical',
        label: strings.pages,
        icon: RowsIcon,
        checked: this._pageLayout === 'vertical',
        onSelect: () => this.setPageLayout('vertical'),
      },
      {
        id: 'layout-continuous',
        label: strings.continuous,
        icon: ContinuousIcon,
        checked: this._pageLayout === 'continuous',
        onSelect: () => this.setPageLayout('continuous'),
      },
      ...(this._pageLayout === 'vertical' ? this.getPageSetupItems() : []),
      {
        id: 'body-text-size',
        label: strings.bodyTextSize(this._bodyFontPt),
        icon: BodyTextIcon,
        onSelect: () => this.cycleBodyFontPt(),
      },
      {
        id: 'export',
        label: strings.export,
        icon: DownloadIcon,
        onSelect: () =>
          this._uiServices?.openExportDialog(this.buildExportTarget()),
      },
    ];
  }

  private getPageSetupItems(): ChromeMenuItem[] {
    const strings = getMessages().canvas.frame;
    return [
      {
        id: 'page-size-letter',
        label: strings.letterSize,
        icon: PageSizeIcon,
        checked: this._pagePreset === 'letter',
        onSelect: () => this.setPagePreset('letter'),
      },
      {
        id: 'page-size-a4',
        label: strings.a4Size,
        icon: PageSizeIcon,
        checked: this._pagePreset === 'a4',
        onSelect: () => this.setPagePreset('a4'),
      },
      {
        id: 'page-margins',
        label: strings.pageMargins(this._pageMargin / 96),
        icon: MarginsIcon,
        onSelect: () => this.cyclePageMargin(),
      },
      {
        id: 'page-numbers',
        label: strings.pageNumbers,
        icon: PageNumbersIcon,
        checked: this._showPageNumbers,
        onSelect: () => this.setShowPageNumbers(!this._showPageNumbers),
      },
    ];
  }

  private buildExportTarget(): ExportTarget {
    // PDF export is a platform capability; markdown only needs saveFile.
    return {
      title: this._displayName || DEFAULT_PAGE_FRAME_DISPLAY_NAME,
      formats: getPlatform().pdfExport ? ['pdf', 'markdown'] : ['markdown'],
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
    // Runs in chunked async batches that yield to the event loop, so the save dialog animation and
    // menu close both paint smoothly.
    const mdPromise = serializeDocToMarkdownChunked(view.state.doc);
    const result = await getPlatform().saveFile({
      suggestedName: `${this.getSafeExportName()}.md`,
      filter: { name: 'Markdown', extensions: ['md', 'markdown'] },
      data: mdPromise,
    });
    return result.cancelled ? { cancelled: true } : {};
  }

  private async runPdfExport(
    includeAnnotations: boolean,
  ): Promise<ExportResult> {
    const pdfExport = getPlatform().pdfExport;
    if (!pdfExport) {
      return { cancelled: true };
    }
    if (!this.contentDiv) {
      return {};
    }
    let warnings: string[] = [];
    const outcome = await pdfExport.export({
      suggestedName: `${this.getSafeExportName()}.pdf`,
      buildRequest: async () => {
        const overlays = includeAnnotations
          ? (this._exportElementsProvider?.() ?? [])
          : [];
        const releaseContent = await this.loadContentForPdf();
        try {
          const source = this.getPdfExportSource(overlays);
          if (!source) {
            return null;
          }
          await prepareExportOverlays(overlays);
          const harvest = await harvestPageFramePdf(source);
          warnings = harvest.warnings;
          return harvest.request;
        } finally {
          releaseContent();
        }
      },
    });
    if (outcome.cancelled) {
      return { cancelled: true };
    }
    return { warnings };
  }

  public async loadContentForPdf(): Promise<() => void> {
    const release = this.contentDiv
      ? await pinEmbedHosts(this.contentDiv)
      : () => undefined;
    // Newly loaded media changes block heights; repaginate before page count is read.
    this.pmEditor?.flushLayout();
    return release;
  }

  public getPdfExportSource(
    overlays?: readonly PdfExportOverlayElement[],
  ): PageFramePdfSource | null {
    const contentDiv = this.contentDiv;
    if (!contentDiv) {
      return null;
    }
    // Continuous frames have no page breaks: harvest as a single page sized to the whole strip
    // (krilla allows an arbitrarily tall page). Measure the editor's live height rather than the
    // cached `totalHeight` — the cache is only kept fresh by the pagination rAF loop, so a
    // freshly-mounted frame could report `null` and collapse the export box to one page.
    const continuous = this._pageLayout === 'continuous';
    const editorDom = this.pmEditor?.view?.dom;
    const pageHeight = continuous
      ? this.continuousStripHeight(
          editorDom instanceof HTMLElement ? editorDom.offsetHeight : null,
        )
      : this._pageHeight;

    return {
      contentDiv,
      numPages: continuous ? 1 : this._numPages,
      pageWidth: this._pageWidth,
      pageHeight,
      pageMargin: this._pageMargin,
      showPageNumbers: !continuous && this._showPageNumbers,
      scale: { x: this.scale.x, y: this.scale.y },
      offset: { x: this.offset.x, y: this.offset.y },
      selfUuid: this.uuid,
      overlays,
    };
  }

  public getCanvasPdfExportData(): CanvasPdfExportData {
    const scaleX = Math.max(Math.abs(this.scale.x), 0.001);
    const scaleY = Math.max(Math.abs(this.scale.y), 0.001);
    return {
      kind: 'page-frame',
      source: this.getPdfExportSource(),
      fallbackBounds: new DOMRect(
        this.offset.x,
        this.offset.y,
        this.totalWidth * scaleX,
        this.totalHeight * scaleY,
      ),
    };
  }

  public setExportElementsProvider(
    provider: () => readonly DrawableElement[],
  ): void {
    this._exportElementsProvider = provider;
  }

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

  // Prefer the live editor doc: the view is created eagerly for every frame and reflects in-flight
  // edits. Otherwise convert the Y.XmlFragment with the same helper the editor uses.
  public getCurrentDoc(): ProseMirrorNode | null {
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

  public getCanvasSearchContent(): CanvasSearchContent | null {
    const doc = this.getCurrentDoc();
    return doc ? { kind: 'page-frame', doc } : null;
  }

  // Runs in element-local coordinates (origin at the top-left of page 0), matching
  // `drawThumbnail`'s caller transform.
  public override drawThumbnail(
    ctx: CanvasRenderingContext2D,
    _deltaTime: number,
  ): void {
    const palette = getCanvasPalette();
    ctx.fillStyle = palette.surface;
    ctx.beginPath();
    ctx.roundRect(0, 0, this._pageWidth, this._pageHeight, PAGE_CORNER_RADIUS);
    ctx.fill();

    const doc = this.getCurrentDoc();
    if (!doc) {
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this._pageWidth, this._pageHeight);
    ctx.clip();
    ctx.translate(this._pageMargin, this._pageMargin);
    renderPageFrameThumbnail(
      doc,
      ctx,
      {
        width: this._pageWidth - this._pageMargin * 2,
        maxHeight: this._pageHeight - this._pageMargin * 2,
      },
      palette,
    );
    ctx.restore();
  }
}
