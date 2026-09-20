import { selectAll } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
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
import { comboMatches, comboToPMKey, registry } from '../../keybinds';
import { parseCssColor } from '../../pdf-export/color';
import type { FontKey } from '../../pdf-export/contract';
import { familyToKey } from '../../pdf-export/fonts';
import type { PdfHarvestContext } from '../../pdf-export/harvest';
import type {
  CanvasSearchContent,
  SearchableElement,
} from '../canvas-searchable-element';
import { DrawableElement } from '../drawable-element';
import { ElementType } from '../element-type';
import {
  applySelectionStyle,
  docFromJson,
  docFromText,
  getDocText,
  getSelectionStyle,
  textSchema,
} from './rich-text';

export interface TextStyle {
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
}

const DEFAULT_STYLE: TextStyle = {
  color: '#1a1a1a',
  fontSize: 24,
  fontFamily: 'sans-serif',
  bold: false,
  italic: false,
};

const DEFAULT_BOX_WIDTH = 200;
const DEFAULT_BOX_HEIGHT = 80;

/**
 * A free-floating text box. The text is a DOM overlay at all times — display and editing share one
 * persistent rich-text view, so entering edit mode only toggles focus and editability instead of
 * swapping render paths. draw2D is a no-op; the pretext layout in `_cachedLines` remains the source
 * for PDF export, thumbnails, and the headless bounding-box fallback.
 */
export class TextElement extends DrawableElement implements SearchableElement {
  private box: DOMRect = new DOMRect(0, 0, 0, 0);
  private _text: string = '';
  private _style: TextStyle;
  private _boxWidth: number = DEFAULT_BOX_WIDTH;
  private _boxHeight: number = DEFAULT_BOX_HEIGHT;
  private _editing: boolean = false;
  private _canvas: DrawableCanvas | null = null;
  private _cachedLines: LayoutLine[] = [];
  private _cachedLineHeight: number = 0;

  private _richText = docFromText('');
  private _view: EditorView | null = null;

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
    this._richText = docFromText(text);
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
      bold: this._style.bold,
      italic: this._style.italic,
      richText: this._richText.toJSON(),
      boxWidth: this._boxWidth,
      boxHeight: this._boxHeight,
    };
  }

  public getCanvasSearchContent(): CanvasSearchContent | null {
    const text = this._text.trim();
    return text ? { kind: 'text', text } : null;
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      text: (v) => {
        this._text = v as string;
        if (!yMap.has('richText')) {
          this._richText = docFromText(this._text);
          this.updateViewDocument();
        }
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
      bold: (v) => {
        this._style.bold = v === true;
      },
      italic: (v) => {
        this._style.italic = v === true;
      },
      richText: (v) => {
        this._richText = docFromJson(v, this._text);
        this._text = getDocText(this._richText);
        this.updateViewDocument();
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

  public override syncFromYMap(keys: Iterable<string>): void {
    const changedKeys = Array.from(keys);
    super.syncFromYMap(changedKeys);
    if (changedKeys.includes('text') && !changedKeys.includes('richText')) {
      this._richText = docFromText(this._text);
      this.updateViewDocument();
    }
    this.recomputeBox();
  }

  public get text(): string {
    return this._text;
  }
  public get style(): TextStyle {
    return this._editing && this._view
      ? getSelectionStyle(this._view.state, this._style)
      : this._style;
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
    const editor = this._view?.dom ?? this.createDom(host);

    const sy = Math.abs(this._scale.y) || 1;
    const screen = viewport.worldToScreen({
      x: this.offset.x,
      y: this.offset.y,
    });

    this.applyContentStyle(editor);

    // Text renders at native font size while the element's scale widens the wrap box, so only the
    // viewport zoom goes into the transform.
    editor.style.left = `${screen.x}px`;
    editor.style.top = `${screen.y}px`;
    editor.style.transform = `scale(${viewport.zoom})`;
    editor.style.minHeight = `${this.box.height * sy}px`;
    editor.style.color = resolveInkColor(this._style.color);
    editor.dataset.editing = this._editing ? 'true' : 'false';
  }

  // syncDOM pushes these each frame; the measure pass applies them first, so a recomputeBox running
  // before the next frame (font or scale change) measures the new wrapping, not the last frame's.
  private applyContentStyle(editor: HTMLElement): void {
    const sx = Math.abs(this._scale.x) || 1;
    editor.style.width = `${this._boxWidth * sx}px`;
    editor.style.fontSize = `${this._style.fontSize}px`;
    editor.style.lineHeight = '1.3';
    editor.style.fontWeight = this._style.bold ? '700' : '400';
    editor.style.fontStyle = this._style.italic ? 'italic' : 'normal';
    // Deduped internally; covers documents opened with existing text boxes,
    // which the tool UI's font loading never sees.
    ensureDisplayFont(this._style.fontFamily);
    this._richText.descendants((node) => {
      for (const mark of node.marks) {
        const family = mark.attrs.fontFamily;
        if (typeof family === 'string') {
          ensureDisplayFont(family);
        }
      }
    });
    editor.style.fontFamily = this._style.fontFamily;
  }

  // scrollHeight never reports less than min-height, so temporarily clear the box floor to measure
  // the content rather than echoing the box's tallest-ever size.
  private measureDomTextHeight(): number {
    const editor = this._view?.dom;
    if (!editor) {
      return 0;
    }
    this.applyContentStyle(editor);
    const minHeight = editor.style.minHeight;
    editor.style.minHeight = '0px';
    const contentHeight = editor.scrollHeight;
    editor.style.minHeight = minHeight;
    return contentHeight;
  }

  private createDom(host: HTMLElement): HTMLElement {
    const owner = this;
    const selectAllCombo = registry.getCombo('canvas:select-all');
    this._view = new EditorView(host, {
      state: EditorState.create({
        schema: textSchema,
        doc: this._richText,
        plugins: selectAllCombo
          ? [keymap({ [comboToPMKey(selectAllCombo)]: selectAll })]
          : [],
      }),
      editable: () => owner._editing,
      handleKeyDown(view, event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (event.shiftKey) {
            view.dispatch(
              view.state.tr.replaceSelectionWith(
                textSchema.nodes.hardBreak.create(),
              ),
            );
          } else {
            owner._canvas?.exitElementEdit();
          }
          return true;
        }
        const property = (
          [
            ['editor:bold', 'bold'],
            ['editor:italic', 'italic'],
          ] as const
        ).find(([action]) =>
          registry
            .getCombos(action)
            .some((combo) => comboMatches(event, combo)),
        )?.[1];
        if (property) {
          event.preventDefault();
          owner.setStyle({ [property]: !owner.style[property] });
          return true;
        }
        return false;
      },
      dispatchTransaction(this: EditorView, transaction: Transaction) {
        const next = this.state.apply(transaction);
        this.updateState(next);
        owner._richText = next.doc;
        owner._text = getDocText(next.doc);
        if (transaction.docChanged) {
          owner.syncToYMap({
            text: owner._text,
            richText: owner._richText.toJSON(),
          });
          owner.updateBounds();
        }
        if (
          transaction.docChanged ||
          transaction.selectionSet ||
          transaction.storedMarksSet
        ) {
          owner.onTransformChanged?.();
        }
      },
    });
    const editor = this._view.dom;
    editor.classList.add('canvas-text-block');
    editor.dataset.elementUuid = this.uuid;
    editor.tabIndex = -1;
    return editor;
  }

  public override disposeDOM(): void {
    this._view?.destroy();
    this._view = null;
  }

  public override enterEditMode(canvas: DrawableCanvas): HTMLElement | null {
    this._editing = true;
    this._canvas = canvas;

    // The canvas syncs DOM right before this call, so the rich-text view exists;
    // that sync ran with _editing still false, so flip pointer events here.
    const view = this._view;
    if (!view) {
      return null;
    }
    view.setProps({ editable: () => true });
    view.dom.dataset.editing = 'true';
    view.dispatch(
      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
    );
    view.focus();
    // WebKit can finish the originating canvas click's focus action after this pointer-up handler.
    requestAnimationFrame(() => {
      if (this._editing && this._view === view) {
        view.focus();
      }
    });
    return view.dom;
  }

  public override exitEditMode(): void {
    this._editing = false;

    const view = this._view;
    const canvas = this._canvas;
    this._canvas = null;

    if (!view || !canvas) {
      return;
    }

    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.selection.head),
      ),
    );
    view.setProps({ editable: () => false });
    view.dom.dataset.editing = 'false';
    view.dom.blur();

    if (!this._text.trim()) {
      canvas.removeElement(this);
      return;
    }
  }

  public setText(text: string) {
    this._text = text;
    this._richText = docFromText(text);
    this.updateViewDocument();
    this.recomputeBox();
    this.syncToYMap({ text, richText: this._richText.toJSON() });
  }

  public setBoxSize(width: number, height: number) {
    this._boxWidth = width;
    this._boxHeight = height;
    this.recomputeBox();
    this.syncToYMap({ boxWidth: width, boxHeight: height });
  }

  public setStyle(updates: Partial<TextStyle>) {
    if (this._editing && this._view) {
      this._view.dispatch(applySelectionStyle(this._view.state, updates));
      this._view.focus();
      return;
    }
    this._style = { ...this._style, ...updates };
    this.recomputeBox();
    this.syncToYMap({
      color: this._style.color,
      fontSize: this._style.fontSize,
      fontFamily: this._style.fontFamily,
      bold: this._style.bold,
      italic: this._style.italic,
    });
    // Font size and family change how the text wraps, so the box moves with the style. Notify so the
    // selection outline and toolbar follow.
    this.onTransformChanged?.();
  }

  private updateViewDocument(): void {
    if (!this._view || this._view.state.doc.eq(this._richText)) {
      return;
    }
    const selection = TextSelection.atEnd(this._richText);
    this._view.updateState(
      EditorState.create({
        schema: textSchema,
        doc: this._richText,
        selection,
        plugins: this._view.state.plugins,
      }),
    );
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
    ctx.font = `${this._style.italic ? 'italic ' : ''}${this._style.bold ? '700 ' : ''}${fontSize}px ${this._style.fontFamily}`;
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
        weight: this._style.bold ? 700 : 400,
        italic: this._style.italic,
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

      // The DOM view is the real renderer, so when mounted measure its content height directly — the
      // box then matches the displayed wrapping exactly, including trailing blank lines from
      // Shift+Enter that pretext's normal-whitespace layout collapses. pretext's line count is the
      // fallback for headless paths (PDF export, thumbnails, before the first render frame).
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
