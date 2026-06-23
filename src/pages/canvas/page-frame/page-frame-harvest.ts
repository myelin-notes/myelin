/**
 * Harvest a page frame's rendered, paginated DOM into a display-list request for the
 * Rust renderer. The pagination is READ from the settled DOM (never recomputed), so
 * each PDF page's content matches the on-screen page exactly. Text is emitted as
 * selectable runs; code blocks are rasterized in place (the code editor can't be
 * harvested reliably).
 */

import { toPng } from 'html-to-image';
import { Logger } from '@/lib/logger';
import { parseCssColor } from '@/lib/pdf-export/color';
import type {
  ExportPage,
  PageItem,
  PdfExportRequest,
} from '@/lib/pdf-export/contract';
import {
  localToPage,
  type PageGeometry,
  POINTS_PER_PX,
  pxToPt,
} from '@/lib/pdf-export/coords';
import { resolveFont } from '@/lib/pdf-export/fonts';
import type { PdfHarvestContext } from '@/lib/pdf-export/harvest';
import { PAGE_GAP } from '../elements/page-frame-constants';
import {
  type PdfExportOverlayElement,
  rectsIntersect,
} from '../pdf-element-export';

const logger = new Logger('PageFramePdfExport');

export interface PageFramePdfSource {
  /** The live `.pm-editor` content element (cloned internally). */
  contentDiv: HTMLElement;
  numPages: number;
  pageWidth: number;
  pageHeight: number;
  pageLayout: 'vertical' | 'horizontal';
  scale?: { x: number; y: number };
  /** This frame's world offset (content top-left) — needed to place overlays. */
  offset: { x: number; y: number };
  /** This frame's uuid, so it isn't stamped onto itself as an overlay. */
  selfUuid: string;
  /** Canvas elements to stamp on top as annotations (empty to skip). */
  overlays?: readonly PdfExportOverlayElement[];
}

const CODE_BLOCK_SELECTOR = '.pm-code-block';
const ASCENT_RATIO = 0.8;
const RULE_GRAY: [number, number, number] = [195, 199, 202];
const TABLE_BORDER_GRAY: [number, number, number] = [210, 214, 218];

interface Harvester {
  pages: ExportPage[];
  imagesB64: string[];
  geom: PageGeometry;
  originX: number;
  originY: number;
}

export interface PageFrameHarvestResult {
  request: PdfExportRequest;
  /** Non-fatal warnings (e.g. code blocks that failed to rasterize). */
  warnings: string[];
}

export async function harvestPageFramePdf(
  source: PageFramePdfSource,
): Promise<PageFrameHarvestResult> {
  const { clone, container } = buildOffscreenClone(source);
  document.body.appendChild(container);
  try {
    await settleLayout();

    const cloneRect = clone.getBoundingClientRect();
    const pages: ExportPage[] = Array.from({ length: source.numPages }, () => ({
      widthPt: pxToPt(source.pageWidth),
      heightPt: pxToPt(source.pageHeight),
      items: [],
    }));

    const h: Harvester = {
      pages,
      imagesB64: [],
      geom: {
        pageWidth: source.pageWidth,
        pageHeight: source.pageHeight,
        pageGap: PAGE_GAP,
        layout: source.pageLayout,
      },
      originX: cloneRect.left,
      originY: cloneRect.top,
    };

    harvestDecorations(h, clone);
    harvestText(h, clone);
    const failedBlocks = await harvestCodeBlocks(h, clone);
    harvestOverlays(h, source);

    const warnings: string[] = [];
    if (failedBlocks > 0) {
      const plural = failedBlocks === 1 ? '' : 's';
      warnings.push(
        `${failedBlocks} code block${plural} couldn't be rendered and ${failedBlocks === 1 ? 'was' : 'were'} omitted.`,
      );
    }

    return {
      request: { kind: 'pageframe', pages, imagesB64: h.imagesB64 },
      warnings,
    };
  } finally {
    container.remove();
  }
}

function buildOffscreenClone(source: PageFramePdfSource): {
  clone: HTMLElement;
  container: HTMLElement;
} {
  const horizontal = source.pageLayout === 'horizontal';
  // Vertical: a single page-wide column that grows downward. Horizontal: the full
  // multi-column width; the inner editor's copied column styles flow the pages.
  const cloneWidth = horizontal
    ? source.numPages * (source.pageWidth + PAGE_GAP)
    : source.pageWidth;

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0px',
    width: `${cloneWidth}px`,
    pointerEvents: 'none',
    background: '#ffffff',
  });

  const clone = source.contentDiv.cloneNode(true) as HTMLElement;
  // Neutralize the live transforms/zoom from dom-layer's sync loop so the clone lays
  // out at its natural scale-1 size; the pagination spacer widgets (and, for
  // horizontal layout, the inner editor's column styles) are already baked into the
  // cloned DOM.
  Object.assign(clone.style, {
    position: 'static',
    inset: 'auto',
    transform: 'none',
    zoom: 'normal',
    width: `${cloneWidth}px`,
    height: horizontal ? `${source.pageHeight}px` : 'auto',
    overflow: 'visible',
  });
  container.appendChild(clone);
  return { clone, container };
}

async function settleLayout(): Promise<void> {
  await document.fonts?.ready?.catch(() => undefined);
  await nextFrame();
  await nextFrame();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Push an item onto the page that contains content-local point (localX, localY). */
function pushAt(
  h: Harvester,
  localX: number,
  localY: number,
  make: (pageX: number, pageY: number) => PageItem,
): void {
  const { pageIndex, xPx, yPx } = localToPage(localX, localY, h.geom);
  if (pageIndex < 0 || pageIndex >= h.pages.length) {
    return;
  }
  h.pages[pageIndex].items.push(make(pxToPt(xPx), pxToPt(yPx)));
}

function harvestText(h: Harvester, root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      // Code blocks are rasterized separately.
      if (parent.closest(CODE_BLOCK_SELECTOR)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (!parent) {
      continue;
    }
    const style = getComputedStyle(parent);
    const { font, weight, italic } = resolveFont(style);
    const fontSizePx = Number.parseFloat(style.fontSize) || 16;
    const { rgb, opacity } = parseCssColor(style.color);

    for (const line of splitTextNodeIntoLines(text)) {
      if (!line.text.trim()) {
        continue;
      }
      const localX = line.rect.left - h.originX;
      const baselineLocalY =
        line.rect.top -
        h.originY +
        (line.rect.height - fontSizePx) / 2 +
        ASCENT_RATIO * fontSizePx;
      pushAt(h, localX, baselineLocalY, (x, y) => ({
        t: 'text',
        x,
        baselineY: y,
        text: line.text,
        font,
        weight,
        italic,
        sizePt: pxToPt(fontSizePx),
        color: rgb,
        opacity,
      }));
    }
  }
}

interface HarvestedLine {
  text: string;
  rect: DOMRect;
}

/**
 * Split a text node into per-line fragments. `getClientRects()` yields one rect per
 * visual line; we assign each character to a line by its own rect's top.
 *
 * A binary search would assume `getBoundingClientRect().top` is monotonic in the
 * character offset, but a boxless character (collapsed whitespace at a wrap point, a
 * soft hyphen) returns an empty/zero rect, breaking that assumption and misplacing
 * characters. Instead we walk every character: those with real geometry advance the
 * line monotonically, and boxless ones inherit the line of the next character that
 * does have geometry (so a collapsed character leading a wrapped line joins it). This
 * is O(n) per node rather than O(lines·log n) — acceptable for export.
 */
function splitTextNodeIntoLines(node: Text): HarvestedLine[] {
  const text = node.textContent ?? '';
  if (!text) {
    return [];
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  const lines = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 || r.height > 0,
  );
  if (lines.length === 0) {
    return [];
  }
  if (lines.length === 1) {
    return [{ text, rect: lines[0] }];
  }

  const tops = lines.map((r) => r.top);
  const lineOf = new Array<number>(text.length).fill(-1);
  const charRange = document.createRange();
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    charRange.setStart(node, i);
    charRange.setEnd(node, i + 1);
    const rc = charRange.getBoundingClientRect();
    if (rc.width > 0 || rc.height > 0) {
      while (line < tops.length - 1 && rc.top >= tops[line + 1] - 1) {
        line++;
      }
      lineOf[i] = line;
    }
  }
  // Boxless chars (lineOf === -1) inherit the nearest geometried char to the right.
  let next = lines.length - 1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (lineOf[i] === -1) {
      lineOf[i] = next;
    } else {
      next = lineOf[i];
    }
  }

  const texts = lines.map(() => '');
  for (let i = 0; i < text.length; i++) {
    texts[lineOf[i]] += text[i];
  }
  return lines.map((rect, k) => ({ text: texts[k], rect }));
}

function harvestDecorations(h: Harvester, root: HTMLElement): void {
  // List markers.
  for (const el of root.querySelectorAll<HTMLElement>('.bullet-list-item')) {
    const r = el.getBoundingClientRect();
    const em = Number.parseFloat(getComputedStyle(el).fontSize) || 16;
    const cx = r.left - h.originX + 0.35 * em + 0.18 * em;
    const cy = r.top - h.originY + em * 0.95;
    const radius = 0.11 * em;
    pushAt(h, cx - radius, cy - radius, (x, y) =>
      circlePath(x + pxToPt(radius), y + pxToPt(radius), pxToPt(radius)),
    );
  }
  for (const el of root.querySelectorAll<HTMLElement>('.ordered-list-item')) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const em = Number.parseFloat(style.fontSize) || 16;
    const order = el.getAttribute('data-order') ?? '1';
    const { rgb } = parseCssColor(style.color);
    const localX = r.left - h.originX + 0.1 * em;
    const baselineY = r.top - h.originY + em * 0.95;
    pushAt(h, localX, baselineY, (x, y) => ({
      t: 'text',
      x,
      baselineY: y,
      text: `${order}.`,
      font: 'hanken',
      weight: 400,
      italic: false,
      sizePt: pxToPt(em),
      color: rgb,
    }));
  }
  for (const input of root.querySelectorAll<HTMLInputElement>(
    '.check-list-item > input[type="checkbox"]',
  )) {
    const r = input.getBoundingClientRect();
    const localX = r.left - h.originX;
    const localY = r.top - h.originY;
    pushAt(h, localX, localY, (x, y) => ({
      t: 'rect',
      x,
      y,
      w: pxToPt(r.width),
      h: pxToPt(r.height),
      stroke: RULE_GRAY,
      lineWidth: 1,
    }));
    if (input.checked) {
      pushAt(h, localX, localY, (x, y) => ({
        t: 'rect',
        x,
        y,
        w: pxToPt(r.width),
        h: pxToPt(r.height),
        fill: [60, 110, 220],
        opacity: 0.85,
      }));
    }
  }

  // Blockquote / callout left rule bar (+ callout background).
  for (const el of root.querySelectorAll<HTMLElement>('blockquote')) {
    const r = el.getBoundingClientRect();
    const localX = r.left - h.originX;
    const localY = r.top - h.originY;
    const bg = parseCssColor(getComputedStyle(el).backgroundColor);
    if (el.classList.contains('pm-callout') && bg.opacity > 0.02) {
      pushAt(h, localX, localY, (x, y) => ({
        t: 'rect',
        x,
        y,
        w: pxToPt(r.width),
        h: pxToPt(r.height),
        fill: bg.rgb,
        opacity: bg.opacity,
      }));
    }
    pushAt(h, localX, localY, (x, y) => ({
      t: 'rect',
      x,
      y,
      w: pxToPt(2),
      h: pxToPt(r.height),
      fill: RULE_GRAY,
      opacity: 0.5,
    }));
  }

  // Horizontal rules.
  for (const el of root.querySelectorAll<HTMLElement>('hr')) {
    const r = el.getBoundingClientRect();
    const localX = r.left - h.originX;
    const localY = r.top - h.originY + r.height / 2;
    const width = r.width;
    pushAt(h, localX, localY, (x, y) => ({
      t: 'line',
      x1: x,
      y1: y,
      x2: x + pxToPt(width),
      y2: y,
      color: RULE_GRAY,
      width: 1,
    }));
  }

  // Table cell borders.
  for (const cell of root.querySelectorAll<HTMLElement>('td, th')) {
    const r = cell.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      continue;
    }
    const localX = r.left - h.originX;
    const localY = r.top - h.originY;
    pushAt(h, localX, localY, (x, y) => ({
      t: 'rect',
      x,
      y,
      w: pxToPt(r.width),
      h: pxToPt(r.height),
      stroke: TABLE_BORDER_GRAY,
      lineWidth: 1,
    }));
  }
}

async function harvestCodeBlocks(
  h: Harvester,
  clone: HTMLElement,
): Promise<number> {
  const cloneBlocks = clone.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR);
  let failed = 0;

  for (let i = 0; i < cloneBlocks.length; i++) {
    const cloneEl = cloneBlocks[i];
    const cloneRect = cloneEl.getBoundingClientRect();
    if (cloneRect.width <= 0 || cloneRect.height <= 0) {
      continue;
    }
    alignCodeBlockGutter(cloneEl);

    let dataUrl: string;
    try {
      dataUrl = await toPng(cloneEl, { pixelRatio: 2 });
    } catch (error) {
      failed++;
      logger.warn('Failed to rasterize code block for PDF export', {
        error,
        index: i,
      });
      continue;
    }
    const comma = dataUrl.indexOf(',');
    if (comma < 0) {
      failed++;
      continue;
    }
    const ref = h.imagesB64.push(dataUrl.slice(comma + 1)) - 1;

    const localX = cloneRect.left - h.originX;
    const localY = cloneRect.top - h.originY;
    pushAt(h, localX, localY, (x, y) => ({
      t: 'image',
      x,
      y,
      w: pxToPt(cloneRect.width),
      h: pxToPt(cloneRect.height),
      imageRef: ref,
    }));
  }
  return failed;
}

/**
 * CodeMirror only measures line heights for editors that have been visible in
 * the window: a code block that was never scrolled into view keeps the height
 * oracle's defaults (14px rows) in its gutter inline styles, so the cloned
 * gutter drifts out of alignment with the content lines (which lay out
 * naturally). Rebuild the gutter rows from the content line geometry before
 * rasterizing.
 */
function alignCodeBlockGutter(block: HTMLElement): void {
  const gutter = block.querySelector<HTMLElement>('.cm-lineNumbers');
  if (!gutter) {
    return;
  }
  const lines = block.querySelectorAll<HTMLElement>('.cm-line');
  const gutterEls = Array.from(
    gutter.querySelectorAll<HTMLElement>('.cm-gutterElement'),
    // CodeMirror's first gutter element is a hidden width spacer.
  ).filter((el) => el.style.visibility !== 'hidden');
  let prevBottom = gutter.getBoundingClientRect().top;
  const count = Math.min(lines.length, gutterEls.length);
  for (let i = 0; i < count; i++) {
    const r = lines[i].getBoundingClientRect();
    gutterEls[i].style.marginTop = `${r.top - prevBottom}px`;
    gutterEls[i].style.height = `${r.height}px`;
    prevBottom = r.top + r.height;
  }
}

/**
 * Stamp overlapping canvas elements (ink/text/images) onto the frame's pages, the
 * same way the PDF element overlays annotations. The frame is unscaled, so one world
 * px maps to one CSS px; each element draws itself in its page's PDF-point space.
 */
function harvestOverlays(h: Harvester, source: PageFramePdfSource): void {
  const overlays = source.overlays;
  if (!overlays || overlays.length === 0) {
    return;
  }
  const horizontal = source.pageLayout === 'horizontal';

  for (let p = 0; p < h.pages.length; p++) {
    const pageWorldX =
      source.offset.x + (horizontal ? p * (source.pageWidth + PAGE_GAP) : 0);
    const pageWorldY =
      source.offset.y + (horizontal ? 0 : p * (source.pageHeight + PAGE_GAP));
    const pageBounds = new DOMRect(
      pageWorldX,
      pageWorldY,
      source.pageWidth,
      source.pageHeight,
    );

    const ctx: PdfHarvestContext = {
      ptPerWorldY: POINTS_PER_PX,
      worldToPagePt: (wx, wy) => ({
        x: (wx - pageWorldX) * POINTS_PER_PX,
        y: (wy - pageWorldY) * POINTS_PER_PX,
      }),
      push: (item) => h.pages[p].items.push(item),
      addImageBase64: (b64) => h.imagesB64.push(b64) - 1,
    };

    for (const element of overlays) {
      if (element.uuid === source.selfUuid || element.hidden) {
        continue;
      }
      if (rectsIntersect(element.boundingBox, pageBounds)) {
        element.drawToPdf(ctx);
      }
    }
  }
}

function circlePath(cx: number, cy: number, r: number): PageItem {
  // Approximate a filled disc with a polygon (krilla path is a polyline).
  const pts: number[] = [];
  const segments = 16;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return { t: 'path', pts, closed: true, fill: [40, 44, 48] };
}
