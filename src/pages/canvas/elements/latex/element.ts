import type * as Y from 'yjs';
import type { PdfHarvestContext } from '@/lib/pdf-export/harvest';
import type { CanvasViewport } from '../../canvas-viewport';
import type { DrawableCanvas } from '../../drawable-canvas';
import { renderKatex } from '../../page-frame/pm/math/render';
import { DrawableElement, ResizeHandles } from '../drawable-element';
import { ElementType } from '../element-type';
import {
  createLatexEditOverlay,
  type LatexEditOverlayHandle,
} from './edit-overlay';

// Box shown for an empty block so a freshly-placed element is still
// selectable and gives the placeholder room to render.
const EMPTY_WIDTH = 140;
const EMPTY_HEIGHT = 44;
const PLACEHOLDER = 'Add LaTeX…';
const EDIT_PANEL_MIN_WIDTH = 240;
const EDIT_PANEL_GAP = 6;
// KaTeX is HTML, so PDF/thumbnail export rasterizes it. Render at 3x so the
// bitmap stays crisp when the block is scaled up or printed.
const RASTER_PIXEL_RATIO = 3;

interface Size {
  width: number;
  height: number;
}

const measureCache = new Map<string, Size>();
const MEASURE_CACHE_LIMIT = 500;

/**
 * Natural rendered size of a block formula (CSS px at scale 1). Renders the
 * shared KaTeX output into a hidden probe and reads its box — the only
 * reliable way to size HTML/font content. Cached per source since KaTeX
 * layout is the expensive part.
 */
function measureLatex(latex: string): Size {
  const cached = measureCache.get(latex);
  if (cached) {
    return cached;
  }

  const probe = document.createElement('div');
  probe.className = 'canvas-latex-block';
  Object.assign(probe.style, {
    position: 'absolute',
    left: '-99999px',
    top: '0',
    visibility: 'hidden',
    width: 'max-content',
  } as Partial<CSSStyleDeclaration>);
  probe.appendChild(renderKatex(latex, true));
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const size: Size = {
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  };
  if (measureCache.size >= MEASURE_CACHE_LIMIT) {
    measureCache.delete(measureCache.keys().next().value!);
  }
  measureCache.set(latex, size);
  return size;
}

/**
 * A free-floating LaTeX block on the canvas — the page frame's math block
 * lifted out of ProseMirror. Rendering and the source editor are the page
 * frame's (renderKatex + the shared MathSourceEditor); only positioning and
 * the DrawableElement plumbing are canvas-specific.
 *
 * KaTeX is HTML, so the block paints as a DOM overlay (like PdfElement) rather
 * than to the 2D canvas: draw2D is a no-op and the visual lives in syncDOM.
 * Resize scales the whole formula uniformly (it doesn't reflow), so it exposes
 * corner handles with a locked aspect ratio, like an image.
 */
export class LatexElement extends DrawableElement {
  private _latex: string;
  private _natural: Size = { width: EMPTY_WIDTH, height: EMPTY_HEIGHT };
  private _editing = false;

  private _root: HTMLDivElement | null = null;
  private _renderedLatex: string | null = null;

  private _editOverlay: LatexEditOverlayHandle | null = null;
  private _canvas: DrawableCanvas | null = null;

  // Rasterized formula for PDF/thumbnail export, keyed by the source it was
  // rendered from so a stale bitmap is never drawn after an edit.
  private _raster: { latex: string; canvas: HTMLCanvasElement } | null = null;

  constructor(uuid: string, latex = '') {
    super(uuid, ElementType.LATEX);
    this._latex = latex;
    this.remeasure();
  }

  public override getYMapProps(): Record<string, unknown> {
    return { latex: this._latex };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      latex: (v) => {
        this._latex = typeof v === 'string' ? v : '';
        this.remeasure();
        // Repaint on the next sync; the editor (if open) owns its own text.
        this._renderedLatex = null;
        this._raster = null;
      },
    });
  }

  public get latex(): string {
    return this._latex;
  }

  public get editing(): boolean {
    return this._editing;
  }

  public override get editable(): boolean {
    return true;
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.Corners;
  }

  public override get maintainAspectRatio(): boolean {
    return true;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(0, 0, this._natural.width, this._natural.height);
  }

  protected isOverLocal(x: number, y: number): boolean {
    return (
      x >= 0 && x <= this._natural.width && y >= 0 && y <= this._natural.height
    );
  }

  protected updateBoundingBox(): void {
    this.remeasure();
  }

  private remeasure(): void {
    this._natural = this._latex.trim()
      ? measureLatex(this._latex)
      : { width: EMPTY_WIDTH, height: EMPTY_HEIGHT };
  }

  private setLatex(latex: string): void {
    if (latex === this._latex) {
      return;
    }
    this._latex = latex;
    this.remeasure();
    this._renderedLatex = null;
    this._raster = null;
    this.syncToYMap({ latex });
    this.updateBounds();
    // Recompute content bounds + repaint the selection at the new size (the
    // element is selected while editing, which is the only time setLatex runs).
    this.onTransformChanged?.();
  }

  // DOM overlay paints the formula; nothing to draw on the 2D canvas.
  protected draw2D(): void {}

  /**
   * Rasterize the current formula to a bitmap for the synchronous export draws
   * (drawToPdf / drawThumbnail). KaTeX has no vector output, so both export
   * paths blit this raster; the shared helper is the page frame's.
   */
  private async ensureRaster(): Promise<void> {
    const latex = this._latex;
    if (!latex.trim()) {
      this._raster = null;
      return;
    }
    if (this._raster?.latex === latex) {
      return;
    }
    const { rasterizeKatex } = await import(
      '../../page-frame/pm/math/rasterize'
    );
    const canvas = await rasterizeKatex(latex, RASTER_PIXEL_RATIO);
    // Drop a result the source has since moved past.
    if (canvas && this._latex === latex) {
      this._raster = { latex, canvas };
    }
  }

  public override prepareForPdf(): Promise<void> {
    return this.ensureRaster();
  }

  public override drawToPdf(ctx: PdfHarvestContext): void {
    const raster = this._raster;
    if (!raster || raster.latex !== this._latex) {
      return;
    }
    const url = raster.canvas.toDataURL('image/png');
    const comma = url.indexOf(',');
    if (comma < 0) {
      return;
    }
    const ref = ctx.addImageBase64(url.slice(comma + 1));
    const bb = this.boundingBox;
    const p0 = ctx.worldToPagePt(bb.x, bb.y);
    const p1 = ctx.worldToPagePt(bb.right, bb.bottom);
    ctx.push({
      t: 'image',
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      w: Math.abs(p1.x - p0.x),
      h: Math.abs(p1.y - p0.y),
      imageRef: ref,
    });
  }

  public override prepareThumbnail(): Promise<void> {
    return this.ensureRaster();
  }

  public override drawThumbnail(ctx: CanvasRenderingContext2D): void {
    const raster = this._raster;
    if (!raster || raster.latex !== this._latex) {
      return;
    }
    // Caller has applied the element's offset + scale, so draw in local space.
    ctx.drawImage(
      raster.canvas,
      0,
      0,
      this._natural.width,
      this._natural.height,
    );
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    const root = this._root ?? this.createDom(host);

    if (this._renderedLatex !== this._latex) {
      this.renderPreview(root);
      this._renderedLatex = this._latex;
    }

    const zoom = viewport.zoom;
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    root.style.transform = `scale(${this._scale.x * zoom}, ${this._scale.y * zoom})`;
    root.dataset.editing = this._editing ? 'true' : 'false';

    this.syncNaturalSize(root);

    if (this._editing && this._editOverlay) {
      this._editOverlay.reposition(this.screenEditRect(viewport));
    }
  }

  /**
   * Keep `_natural` in lockstep with the actually-rendered formula. The preview
   * shrink-wraps its content (CSS `width: max-content`), so its layout size is
   * the true formula size — including whatever the synchronous offscreen probe
   * got wrong before KaTeX's web fonts loaded. The selection box and hit-test
   * both derive from `_natural`, so reading it back keeps them on the glyphs at
   * every zoom; `offsetWidth/Height` ignore the element's scale transform, so
   * they report the unscaled natural size directly.
   */
  private syncNaturalSize(root: HTMLDivElement): void {
    if (!this._latex.trim()) {
      root.style.width = `${EMPTY_WIDTH}px`;
      root.style.height = `${EMPTY_HEIGHT}px`;
      return;
    }
    root.style.width = '';
    root.style.height = '';
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    if (
      width > 0 &&
      height > 0 &&
      (width !== this._natural.width || height !== this._natural.height)
    ) {
      this._natural = { width, height };
      // Refresh content bounds + repaint the selection outline at the new size.
      this.onTransformChanged?.();
    }
  }

  public override disposeDOM(): void {
    this._root?.remove();
    this._root = null;
    this._renderedLatex = null;
    this._raster = null;
  }

  private createDom(host: HTMLElement): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'canvas-latex-block';
    root.dataset.elementUuid = this.uuid;
    host.appendChild(root);
    this._root = root;
    return root;
  }

  private renderPreview(root: HTMLDivElement): void {
    if (this._latex.trim()) {
      root.dataset.empty = 'false';
      root.replaceChildren(renderKatex(this._latex, true));
    } else {
      root.dataset.empty = 'true';
      root.dataset.placeholder = PLACEHOLDER;
      root.replaceChildren();
    }
  }

  private screenEditRect(viewport: CanvasViewport): {
    left: number;
    top: number;
    width: number;
  } {
    // Anchor to the preview's real on-screen rect (true page coords) so the
    // panel sits flush below it like the page frame's source editor —
    // worldToScreen is canvas-local, which drifts off the preview by however
    // far the canvas is offset within the page. Fall back to the viewport math
    // only before the preview's first sync.
    const root = this._root;
    if (root) {
      const r = root.getBoundingClientRect();
      return {
        left: r.left,
        top: r.bottom + EDIT_PANEL_GAP,
        width: Math.max(EDIT_PANEL_MIN_WIDTH, r.width),
      };
    }
    const box = this.boundingBox;
    const topLeft = viewport.worldToScreen({ x: box.x, y: box.y });
    return {
      left: topLeft.x,
      top: topLeft.y + box.height * viewport.zoom + EDIT_PANEL_GAP,
      width: Math.max(EDIT_PANEL_MIN_WIDTH, box.width * viewport.zoom),
    };
  }

  public override enterEditMode(canvas: DrawableCanvas): HTMLElement | null {
    this._editing = true;
    this._canvas = canvas;

    const overlay = createLatexEditOverlay({
      initialLatex: this._latex,
      rect: this.screenEditRect(canvas.viewport),
      onChange: (latex) => this.setLatex(latex),
      onCommit: () => canvas.exitElementEdit(),
    });
    this._editOverlay = overlay;
    return overlay.root;
  }

  public override exitEditMode(): void {
    this._editing = false;
    const overlay = this._editOverlay;
    const canvas = this._canvas;
    this._editOverlay = null;
    this._canvas = null;

    if (overlay) {
      this.setLatex(overlay.getValue());
      overlay.dispose();
    }

    if (!this._latex.trim() && canvas) {
      canvas.removeElement(this);
    }
  }
}
