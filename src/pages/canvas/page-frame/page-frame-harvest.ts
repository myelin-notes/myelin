/**
 * Harvest a page frame's rendered, paginated DOM into a display-list request for the
 * Rust renderer. The pagination is READ from the settled DOM (never recomputed), so
 * each PDF page's content matches the on-screen page exactly. Text is emitted as
 * selectable runs; code blocks are rasterized in place (Monaco can't be harvested
 * reliably).
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
  pxToPt,
} from '@/lib/pdf-export/coords';
import { resolveFont } from '@/lib/pdf-export/fonts';
import { PAGE_GAP } from '../elements/page-frame-constants';

const logger = new Logger('PageFramePdfExport');

export interface PageFramePdfSource {
  /** The live `.pm-editor` content element (cloned internally). */
  contentDiv: HTMLElement;
  numPages: number;
  pageWidth: number;
  pageHeight: number;
  pageLayout: 'vertical' | 'horizontal';
}

const CODE_BLOCK_SELECTOR = '.pm-monaco-code-block';
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

export async function harvestPageFramePdf(
  source: PageFramePdfSource,
): Promise<PdfExportRequest> {
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
    await harvestCodeBlocks(h, clone, source.contentDiv);

    return { kind: 'pageframe', pages, imagesB64: h.imagesB64 };
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
 * visual line; we binary-search the character offsets where each line starts.
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

  const starts = [0];
  for (let k = 1; k < lines.length; k++) {
    const targetTop = lines[k].top;
    let lo = starts[k - 1] + 1;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (charTop(node, mid) >= targetTop - 1) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    starts.push(lo);
  }
  starts.push(text.length);

  return lines.map((rect, k) => ({
    text: text.slice(starts[k], starts[k + 1]),
    rect,
  }));
}

function charTop(node: Text, i: number): number {
  const r = document.createRange();
  r.setStart(node, i);
  r.setEnd(node, Math.min(i + 1, (node.textContent ?? '').length));
  return r.getBoundingClientRect().top;
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
      font: 'inter',
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
  live: HTMLElement,
): Promise<void> {
  const cloneBlocks = clone.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR);
  const liveBlocks = live.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR);

  for (let i = 0; i < cloneBlocks.length; i++) {
    const cloneEl = cloneBlocks[i];
    // Rasterize the LIVE Monaco block (the clone's Monaco DOM is inert/incomplete).
    const liveEl = liveBlocks[i] ?? cloneEl;
    const r = cloneEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      continue;
    }

    let dataUrl: string;
    try {
      dataUrl = await toPng(liveEl, { pixelRatio: 2 });
    } catch (error) {
      logger.warn('Failed to rasterize code block for PDF export', {
        error,
        index: i,
      });
      continue;
    }
    const comma = dataUrl.indexOf(',');
    if (comma < 0) {
      continue;
    }
    const ref = h.imagesB64.push(dataUrl.slice(comma + 1)) - 1;

    const localX = r.left - h.originX;
    const localY = r.top - h.originY;
    pushAt(h, localX, localY, (x, y) => ({
      t: 'image',
      x,
      y,
      w: pxToPt(r.width),
      h: pxToPt(r.height),
      imageRef: ref,
    }));
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
