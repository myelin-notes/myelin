import {
  Columns3 as ColumnsIcon,
  Download as DownloadIcon,
  Rows3 as RowsIcon,
} from 'lucide-react';
import { Selection } from 'prosemirror-state';
import { toast } from 'sonner';
import type * as Y from 'yjs';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import { UserPrefs } from '@/lib/user-prefs';
import type { ChromeMenuItem } from '../chrome-menu';
import type { DrawableCanvas } from '../drawable-canvas';
import { serializeDocToMarkdownChunked } from '../page-frame/markdown-serializer';
import { PageFrameEditorState } from '../page-frame/pm/editor-state';
import type { ResolveNoteLink as NoteLinkResolver } from '../page-frame/pm/markdown/note-links';
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
  DEFAULT_PAGE_LAYOUT,
  normalizePageFrameDisplayName,
  normalizePageLayout,
  PAGE_GAP,
  PAGE_HEIGHT,
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

const logger = new Logger('PageFrameElement');

export class PageFrameElement extends DrawableElement {
  private _pageWidth = PAGE_WIDTH;
  private _pageHeight = PAGE_HEIGHT;
  private _displayName: string;
  private _pageLayout: PageLayout = DEFAULT_PAGE_LAYOUT;
  private _editing = false;
  private _numPages = 1;
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
    pageLayout: PageLayout = DEFAULT_PAGE_LAYOUT,
  ) {
    super(uuid, ElementType.PAGE_FRAME);
    this._displayName = displayName ?? DEFAULT_PAGE_FRAME_DISPLAY_NAME;
    this._pageLayout = normalizePageLayout(pageLayout);
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
        this._pageLayout = normalizePageLayout(v);
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
    const next = normalizePageLayout(pageLayout);
    if (next === this._pageLayout) {
      return;
    }
    this._pageLayout = next;
    this.syncToYMap({ pageLayout: next });
  }
  public get numPages(): number {
    return this._numPages;
  }
  public set numPages(n: number) {
    this._numPages = n;
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
    return n * this._pageHeight + Math.max(0, n - 1) * PAGE_GAP;
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
      const pageLeft =
        this._pageLayout === 'horizontal' ? pageIndex * pageStride : 0;
      const pageTop =
        this._pageLayout === 'horizontal' ? 0 : pageIndex * pageStride;
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
        label: 'Vertical pages',
        icon: RowsIcon,
        checked: this._pageLayout === 'vertical',
        onSelect: () => this.setPageLayout('vertical'),
      },
      {
        id: 'layout-horizontal',
        label: 'Horizontal pages',
        icon: ColumnsIcon,
        checked: this._pageLayout === 'horizontal',
        onSelect: () => this.setPageLayout('horizontal'),
      },
      {
        id: 'export-markdown',
        label: 'Export to Markdown',
        icon: DownloadIcon,
        onSelect: () => {
          void this.exportMarkdown();
        },
      },
    ];
  }

  private async exportMarkdown(): Promise<void> {
    const view = this.pmEditor?.view;
    if (!view) {
      return;
    }
    // Kick off serialization in the background — it runs in chunked async
    // batches that yield to the event loop, so the save dialog animation
    // and menu close both paint smoothly while the doc is processed.
    const mdPromise = serializeDocToMarkdownChunked(view.state.doc);
    try {
      const safeName =
        [...this._displayName]
          .map((char) =>
            char.charCodeAt(0) <= 0x1f || '/\\:*?"<>|'.includes(char)
              ? '-'
              : char,
          )
          .join('')
          .trim() || DEFAULT_PAGE_FRAME_DISPLAY_NAME;
      const path = await save({
        defaultPath: `${safeName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      if (!path) {
        return;
      }
      const md = await mdPromise;
      await writeTextFile(path, md);
      toast.success('Exported to Markdown');
    } catch (err) {
      logger.error('Export to Markdown failed', err, { uuid: this.uuid });
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}
}
