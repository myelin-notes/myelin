import type * as Y from 'yjs';
import {
  type LayoutLine,
  layoutWithLines,
  prepareWithSegments,
} from '@chenglou/pretext';
import { resolveInkColor } from '../../canvas-theme';
import type { CanvasViewport } from '../../canvas-viewport';
import type { DrawableCanvas } from '../../drawable-canvas';
import { ensureDisplayFont, fetchFontTtfBase64 } from '../../google-fonts';
import { parseCssColor } from '../../pdf-export/color';
import type { FontKey } from '../../pdf-export/contract';
import { familyToKey } from '../../pdf-export/fonts';
import type { PdfHarvestContext } from '../../pdf-export/harvest';
import { DrawableElement } from '../drawable-element';
import { ElementType } from '../element-type';

export interface TextStyle {
  color: string;
  fontSize: number;
  fontFamily: string;
}

const DEFAULT_STYLE: TextStyle = {
  color: '#1a1a1a',
  fontSize: 24,
  fontFamily: 'sans-serif',
};

const DEFAULT_BOX_WIDTH = 200;
const DEFAULT_BOX_HEIGHT = 80;

/**
 * A free-floating text box on the canvas. The text is a DOM overlay at all
 * times — display and editing share one persistent textarea (like
 * LatexElement's preview), so entering edit mode only toggles focus and
 * editability instead of swapping render paths. draw2D is a no-op; the
 * pretext layout in `_cachedLines` remains the source for PDF export,
 * thumbnails, and the bounding box.
 */
export class TextElement extends DrawableElement {
  private box: DOMRect = new DOMRect(0, 0, 0, 0);
  private _text: string = '';
  private _style: TextStyle;
  private _boxWidth: number = DEFAULT_BOX_WIDTH;
  private _boxHeight: number = DEFAULT_BOX_HEIGHT;
  private _editing: boolean = false;
  private _oldText: string = '';
  private _canvas: DrawableCanvas | null = null;
  private _cachedLines: LayoutLine[] = [];
  private _cachedLineHeight: number = 0;

  private _textarea: HTMLTextAreaElement | null = null;

  // TTF bytes for the display font, staged by prepareForPdf so the synchronous
  // drawToPdf pass can embed the real face; null falls back to familyToKey.
  private _pdfFontB64: string | null = null;

  public constructor(
    uuid: string,
    text: string = '',
    style: Partial<TextStyle> = {},
    boxWidth: number = DEFAULT_BOX_WIDTH,
    boxHeight: number = DEFAULT_BOX_HEIGHT,
  ) {
    super(uuid, ElementType.TEXT);
    this._text = text;
    this._style = { ...DEFAULT_STYLE, ...style };
    this._boxWidth = boxWidth;
    this._boxHeight = boxHeight;
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      text: this._text,
      color: this._style.color,
      fontSize: this._style.fontSize,
      fontFamily: this._style.fontFamily,
      boxWidth: this._boxWidth,
      boxHeight: this._boxHeight,
    };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      text: (v) => {
        this._text = v as string;
      },
      color: (v) => {
        this._style.color = v as string;
      },
      fontSize: (v) => {
        this._style.fontSize = v as number;
      },
      fontFamily: (v) => {
        this._style.fontFamily = v as string;
      },
      boxWidth: (v) => {
        this._boxWidth = v as number;
      },
      boxHeight: (v) => {
        this._boxHeight = v as number;
        this.recomputeBox();
      },
    });
    this.recomputeBox();
  }

  public get text(): string {
    return this._text;
  }
  public get style(): TextStyle {
    return this._style;
  }
  public get boxWidth(): number {
    return this._boxWidth;
  }
  public get boxHeight(): number {
    return this._boxHeight;
  }
  public get editing(): boolean {
    return this._editing;
  }

  public override get editable(): boolean {
    return true;
  }

  public override get keepsSelectionToolbarWhileEditing(): boolean {
    return true;
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    const textarea = this._textarea ?? this.createDom(host);

    const sy = Math.abs(this._scale.y) || 1;
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });

    this.applyContentStyle(textarea);

    // Text renders at native font size while the element's scale widens the
    // wrap box (matching the old canvas draw, which counter-scaled glyphs),
    // so only the viewport zoom goes into the transform.
    textarea.style.left = `${screen.x}px`;
    textarea.style.top = `${screen.y}px`;
    textarea.style.transform = `scale(${viewport.zoom})`;
    textarea.style.height = `${this.box.height * sy}px`;
    textarea.style.color = resolveInkColor(this._style.color);
    textarea.dataset.editing = this._editing ? 'true' : 'false';
  }

  /**
   * The text plus everything that decides how it wraps. syncDOM pushes these
   * each frame; the measure pass applies them first so a recomputeBox that runs
   * before the next frame (font or scale change) measures the new wrapping
   * rather than the last frame's.
   */
  private applyContentStyle(textarea: HTMLTextAreaElement): void {
    // Remote/undo edits land here; skip while editing so the user's
    // in-progress typing isn't clobbered.
    if (!this._editing && textarea.value !== this._text) {
      textarea.value = this._text;
    }

    const sx = Math.abs(this._scale.x) || 1;
    textarea.style.width = `${this._boxWidth * sx}px`;
    textarea.style.fontSize = `${this._style.fontSize}px`;
    textarea.style.lineHeight = `${this._style.fontSize * 1.3}px`;
    // Deduped internally; covers documents opened with existing text boxes,
    // which the tool UI's font loading never sees.
    ensureDisplayFont(this._style.fontFamily);
    textarea.style.fontFamily = this._style.fontFamily;
  }

  /**
   * Height of the textarea's content in native-font pixels, or 0 when it isn't
   * mounted. Measured at height 0: scrollHeight never reports less than the
   * element's own height, and syncDOM sizes the textarea from the box, so
   * measuring as-is would echo the box height straight back and pin the box to
   * its tallest-ever size.
   */
  private measureDomTextHeight(): number {
    const textarea = this._textarea;
    if (!textarea) {
      return 0;
    }
    this.applyContentStyle(textarea);
    const height = textarea.style.height;
    textarea.style.height = '0px';
    const contentHeight = textarea.scrollHeight;
    textarea.style.height = height;
    return contentHeight;
  }

  private createDom(host: HTMLElement): HTMLTextAreaElement {
    const textarea = document.createElement('textarea');
    textarea.className = 'canvas-text-block';
    textarea.dataset.elementUuid = this.uuid;
    textarea.value = this._text;
    textarea.readOnly = true;
    // Not tab-reachable while idle; edit mode focuses it programmatically.
    textarea.tabIndex = -1;
    // Grow the box to fit as the user types. Without this the fixed-height
    // textarea would scroll its content (overflow: hidden) instead of the box
    // extending downwards. recomputeBox() runs off _text, so update it first.
    textarea.addEventListener('input', () => {
      this._text = textarea.value;
      this.updateBounds();
      this.onTransformChanged?.();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this._canvas?.exitElementEdit();
      }
    });
    host.appendChild(textarea);
    this._textarea = textarea;
    return textarea;
  }

  public override disposeDOM(): void {
    this._textarea?.remove();
    this._textarea = null;
  }

  public override enterEditMode(canvas: DrawableCanvas): HTMLElement | null {
    this._editing = true;
    this._oldText = this._text;
    this._canvas = canvas;

    // The canvas syncs DOM right before this call, so the textarea exists;
    // that sync ran with _editing still false, so flip pointer events here.
    const textarea = this._textarea;
    if (!textarea) {
      return null;
    }
    textarea.dataset.editing = 'true';
    textarea.readOnly = false;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    return textarea;
  }

  public override exitEditMode(): void {
    this._editing = false;

    const textarea = this._textarea;
    const canvas = this._canvas;
    this._canvas = null;

    if (!textarea || !canvas) {
      return;
    }

    textarea.readOnly = true;
    textarea.dataset.editing = 'false';
    // Collapse the selection; a blurred textarea otherwise keeps painting its
    // (greyed-out) highlight over the text.
    textarea.setSelectionRange(0, 0);
    textarea.blur();

    const newText = textarea.value;
    if (!newText.trim()) {
      canvas.removeElement(this);
      return;
    }

    if (newText !== this._oldText) {
      this.setText(newText);
      this.updateBounds();
    }
  }

  public setText(text: string) {
    this._text = text;
    this.recomputeBox();
    this.syncToYMap({ text });
  }

  public setBoxSize(width: number, height: number) {
    this._boxWidth = width;
    this._boxHeight = height;
    this.recomputeBox();
    this.syncToYMap({ boxWidth: width, boxHeight: height });
  }

  public setStyle(updates: Partial<TextStyle>) {
    this._style = { ...this._style, ...updates };
    this.recomputeBox();
    this.syncToYMap({
      color: this._style.color,
      fontSize: this._style.fontSize,
      fontFamily: this._style.fontFamily,
    });
    // Font size and family change how the text wraps, so the box this element
    // occupies moves with the style. Notify like the other geometry setters do
    // so the selection outline and toolbar follow.
    this.onTransformChanged?.();
  }

  // The DOM overlay paints the text; nothing to draw on the 2D canvas.
  protected draw2D(): void {}

  public override drawThumbnail(
    ctx: CanvasRenderingContext2D,
    _deltaTime: number,
  ): void {
    if (!this._text) {
      return;
    }
    const sx = this._scale.x;
    const sy = this._scale.y;

    // Counter the caller's scale so text renders at native font size
    ctx.scale(1 / sx, 1 / sy);

    const fontSize = this._style.fontSize;
    ctx.font = `${fontSize}px ${this._style.fontFamily}`;
    ctx.fillStyle = resolveInkColor(this._style.color);
    ctx.textBaseline = 'top';

    const lh = this._cachedLineHeight;
    for (let i = 0; i < this._cachedLines.length; i++) {
      ctx.fillText(this._cachedLines[i].text, 0, i * lh);
    }
  }

  public override prepareForPdf(): Promise<void> {
    return fetchFontTtfBase64(this._style.fontFamily).then((b64) => {
      this._pdfFontB64 = b64;
    });
  }

  public override drawToPdf(ctx: PdfHarvestContext): void {
    if (!this._text || this._cachedLines.length === 0) {
      return;
    }
    // Text renders at native font size regardless of element scale; in world
    // space the block therefore starts at `offset` with line height `lh`.
    const { rgb, opacity } = parseCssColor(this._style.color);
    const font: FontKey = this._pdfFontB64
      ? { custom: ctx.addFontBase64(this._pdfFontB64) }
      : familyToKey(this._style.fontFamily);
    const fontSize = this._style.fontSize;
    const lh = this._cachedLineHeight;
    const ascent = fontSize * 0.8;
    const sizePt = fontSize * ctx.ptPerWorldY;

    for (let i = 0; i < this._cachedLines.length; i++) {
      const text = this._cachedLines[i].text;
      if (!text) {
        continue;
      }
      const p = ctx.worldToPagePt(
        this.offset.x,
        this.offset.y + i * lh + ascent,
      );
      ctx.push({
        t: 'text',
        x: p.x,
        baselineY: p.y,
        text,
        font,
        weight: 400,
        italic: false,
        sizePt,
        color: rgb,
        opacity,
      });
    }
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    const b = this.box;
    return x >= b.x && x <= b.right && y >= b.y && y <= b.bottom;
  }

  public get localBoundingBox(): DOMRect {
    return this.box;
  }

  protected updateBoundingBox(): void {
    this.recomputeBox();
  }

  private recomputeBox() {
    const sx = Math.abs(this._scale.x) || 1;
    const sy = Math.abs(this._scale.y) || 1;
    const fontSize = this._style.fontSize;
    const lineHeight = fontSize * 1.3;
    this._cachedLineHeight = lineHeight;

    let localHeight = this._boxHeight;

    if (this._text) {
      const fontString = `${fontSize}px ${this._style.fontFamily}`;
      const effectiveWidth = this._boxWidth * sx;
      const prepared = prepareWithSegments(this._text, fontString);
      this._cachedLines = layoutWithLines(
        prepared,
        effectiveWidth,
        lineHeight,
      ).lines;

      // The textarea is the real renderer (display and editing share it), so
      // when it's mounted measure its content height directly — the box then
      // matches the displayed wrapping exactly, including trailing blank lines
      // from Shift+Enter that pretext's normal-whitespace layout collapses.
      // pretext's line count is the fallback for headless paths (PDF export,
      // thumbnails, before the first render frame) where no laid-out textarea
      // exists. Both are visual (native-font) pixel heights.
      const domHeight = this.measureDomTextHeight();
      const textHeight =
        domHeight > 0 ? domHeight : this._cachedLines.length * lineHeight;

      if (sx === 1 && sy === 1) {
        // Unscaled: grow box to fit text permanently
        if (textHeight > this._boxHeight) {
          this._boxHeight = textHeight;
        }
        localHeight = this._boxHeight;
      } else {
        // Scaled: local height must produce correct world height
        // boundingBox = local * scale, so local = visualHeight / sy
        localHeight = Math.max(this._boxHeight, textHeight / sy);
      }
    } else {
      this._cachedLines = [];
    }

    this.box = new DOMRect(0, 0, this._boxWidth, localHeight);
  }
}
