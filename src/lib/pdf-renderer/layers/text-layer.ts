import { OPS } from 'pdfjs-dist';
import { type Matrix, multiply } from '../transform';
import type { RenderContext } from '../types';

interface TextItem {
  str: string;
  dir: string;
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

interface TextStyle {
  ascent: number;
  descent: number;
  vertical: boolean;
  fontFamily: string;
}

// Text-rendering mode bits from the PDF spec (Tr operator).
const TR_FILL = 0;
const TR_STROKE = 1;
const TR_FILL_STROKE = 2;
const TR_INVISIBLE = 3;

const SPACE_PATTERN = / /g;
const SPACING_EPSILON = 0.01;

interface TextEvent {
  // Page-space origin in viewport (CSS) pixels.
  x: number;
  y: number;
  fontName: string;
  fillColor: string;
  strokeColor: string;
  renderingMode: number;
}

interface OperatorGlyph {
  unicode?: string;
  width?: number;
  isSpace?: boolean;
}

interface ExtractedTextRun {
  text: string;
  x: number;
  y: number;
  pdfX: number;
  pdfY: number;
  fontName: string;
  fontHeight: number;
  targetWidth: number;
  angle: number;
  fillColor: string;
  strokeColor: string;
  renderingMode: number;
  segments?: ExtractedTextSegment[];
}

interface ExtractedTextSegment {
  text: string;
  x: number;
  y: number;
  targetWidth: number;
}

/**
 * Walk the operator list and emit a TextEvent for every text-showing op,
 * capturing fill/stroke color + position at the moment of the op. We later
 * match each TextContent item to its nearest event to pick up color.
 */
function extractTextEvents(
  fnArray: number[],
  argsArray: unknown[],
  viewportTransform: Matrix,
): TextEvent[] {
  const events: TextEvent[] = [];
  const ctmStack: Matrix[] = [];
  let ctm: Matrix = [...viewportTransform] as Matrix;
  let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let textLineMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let fontName = '';
  let fillColor = '#000';
  let strokeColor = '#000';
  let renderingMode = TR_FILL;
  let leading = 0;

  const record = () => {
    const full = multiply(ctm, textMatrix);
    events.push({
      x: full[4],
      y: full[5],
      fontName,
      fillColor,
      strokeColor,
      renderingMode,
    });
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        ctmStack.push([...ctm] as Matrix);
        break;
      case OPS.restore:
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop()!;
        }
        break;
      case OPS.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case OPS.beginText:
        textMatrix = [1, 0, 0, 1, 0, 0];
        textLineMatrix = [1, 0, 0, 1, 0, 0];
        break;
      case OPS.setTextMatrix:
        textMatrix = [...((args?.[0] as number[]) ?? args)] as Matrix;
        textLineMatrix = [...textMatrix] as Matrix;
        break;
      case OPS.setLeading:
        leading = args?.[0] as number;
        break;
      case OPS.setLeadingMoveText: {
        leading = -(args?.[1] as number);
        const tx = args?.[0] as number;
        const ty = args?.[1] as number;
        textLineMatrix = multiply(textLineMatrix, [
          1,
          0,
          0,
          1,
          tx,
          ty,
        ] as Matrix);
        textMatrix = [...textLineMatrix] as Matrix;
        break;
      }
      case OPS.moveText: {
        const tx = args?.[0] as number;
        const ty = args?.[1] as number;
        textLineMatrix = multiply(textLineMatrix, [
          1,
          0,
          0,
          1,
          tx,
          ty,
        ] as Matrix);
        textMatrix = [...textLineMatrix] as Matrix;
        break;
      }
      case OPS.nextLine:
        textLineMatrix = multiply(textLineMatrix, [
          1,
          0,
          0,
          1,
          0,
          -leading,
        ] as Matrix);
        textMatrix = [...textLineMatrix] as Matrix;
        break;
      case OPS.setFont:
        fontName = (args?.[0] as string) ?? fontName;
        break;
      case OPS.setFillRGBColor:
        fillColor = (args?.[0] as string) ?? fillColor;
        break;
      case OPS.setStrokeRGBColor:
        strokeColor = (args?.[0] as string) ?? strokeColor;
        break;
      case OPS.setFillTransparent:
        fillColor = 'transparent';
        break;
      case OPS.setStrokeTransparent:
        strokeColor = 'transparent';
        break;
      case OPS.setTextRenderingMode:
        renderingMode = (args?.[0] as number) ?? TR_FILL;
        break;
      case OPS.showText:
      case OPS.showSpacedText:
      case OPS.nextLineShowText:
      case OPS.nextLineSetSpacingShowText:
        record();
        break;
      default:
        break;
    }
  }
  return events;
}

function pickColor(
  item: TextItem,
  events: TextEvent[],
): {
  fill: string;
  stroke: string;
  mode: number;
} {
  let best: TextEvent | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const ix = item.transform[4];
  const iy = item.transform[5];
  // Match by fontName when possible, then by nearest position in PDF space.
  for (const ev of events) {
    if (ev.fontName && ev.fontName !== item.fontName) {
      continue;
    }
    const d = (ev.x - ix) * (ev.x - ix) + (ev.y - iy) * (ev.y - iy);
    if (d < bestDist) {
      bestDist = d;
      best = ev;
    }
  }
  if (!best) {
    return { fill: '#000', stroke: '#000', mode: TR_FILL };
  }
  return {
    fill: best.fillColor,
    stroke: best.strokeColor,
    mode: best.renderingMode,
  };
}

function pickDirection(item: TextItem | null): string {
  return item?.dir ?? 'ltr';
}

function pickNearestTextItem(
  run: Pick<ExtractedTextRun, 'fontName' | 'pdfX' | 'pdfY'>,
  items: TextItem[],
): TextItem | null {
  let best: TextItem | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.fontName !== run.fontName) {
      continue;
    }
    const d =
      (item.transform[4] - run.pdfX) * (item.transform[4] - run.pdfX) +
      (item.transform[5] - run.pdfY) * (item.transform[5] - run.pdfY);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

function readGlyphsFromShowTextArg(arg: unknown): OperatorGlyph[] {
  return Array.isArray(arg) ? (arg as OperatorGlyph[]) : [];
}

function getTextAdvance(
  glyphs: OperatorGlyph[],
  fontSize: number,
  charSpacing: number,
  wordSpacing: number,
  hScale: number,
): number {
  let advance = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    const unicode = glyph.unicode ?? '';
    const glyphWidth = ((glyph.width ?? 0) / 1000) * fontSize;
    advance += (glyphWidth + charSpacing + (unicode === ' ' ? wordSpacing : 0)) * hScale;
  }
  return advance;
}

function getGlyphWidth(
  glyph: OperatorGlyph,
  fontSize: number,
  hScale: number,
): number {
  return ((glyph.width ?? 0) / 1000) * fontSize * hScale;
}

function getGlyphSpacing(
  glyph: OperatorGlyph,
  charSpacing: number,
  wordSpacing: number,
  hScale: number,
): number {
  const unicode = glyph.unicode ?? '';
  return (charSpacing + (unicode === ' ' ? wordSpacing : 0)) * hScale;
}

function extractTextFromGlyphs(glyphs: OperatorGlyph[]): string {
  return glyphs.map((glyph) => glyph.unicode ?? '').join('');
}

function extractTextRuns(
  fnArray: number[],
  argsArray: unknown[],
  viewportTransform: Matrix,
  styles: Record<string, TextStyle>,
): ExtractedTextRun[] {
  const runs: ExtractedTextRun[] = [];
  const ctmStack: Array<{
    ctm: Matrix;
    textMatrix: Matrix;
    textLineMatrix: Matrix;
    fontName: string;
    fontSize: number;
    fillColor: string;
    strokeColor: string;
    renderingMode: number;
    leading: number;
    charSpacing: number;
    wordSpacing: number;
    hScale: number;
    textRise: number;
  }> = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let textLineMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let fontName = '';
  let fontSize = 0;
  let fillColor = '#000';
  let strokeColor = '#000';
  let renderingMode = TR_FILL;
  let leading = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 1;
  let textRise = 0;

  const advanceTextMatrix = (advance: number) => {
    textMatrix = multiply(textMatrix, [1, 0, 0, 1, advance, 0]);
  };

  const emitGlyphRun = (
    parts: Array<OperatorGlyph | number>,
    hasExplicitAdjustments = false,
  ) => {
    const glyphs = parts.filter(
      (part): part is OperatorGlyph => typeof part !== 'number',
    );
    const text = extractTextFromGlyphs(glyphs);
    const explicitAdvance = parts.reduce<number>((sum, part) => {
      if (typeof part !== 'number') {
        return sum;
      }
      return sum + (-(part / 1000) * fontSize) * hScale;
    }, 0);
    const advance =
      getTextAdvance(glyphs, fontSize, charSpacing, wordSpacing, hScale) +
      explicitAdvance;
    const style = styles[fontName];
    if (!text) {
      advanceTextMatrix(advance);
      return;
    }
    if (style?.vertical) {
      advanceTextMatrix(advance);
      return;
    }

    const textSpaceToPdf = multiply(ctm, textMatrix);
    const textSpaceToViewport = multiply(viewportTransform, textSpaceToPdf);
    const baselineScale = Math.hypot(textSpaceToViewport[0], textSpaceToViewport[1]);
    const fontHeight = fontSize * Math.hypot(textSpaceToViewport[2], textSpaceToViewport[3]);
    if (fontHeight < 0.1) {
      advanceTextMatrix(advance);
      return;
    }

    let cursor = 0;
    let visibleStart = 0;
    let visibleWidth = 0;
    let sawGlyph = false;
    const preciseSpacing =
      Math.abs(charSpacing) > SPACING_EPSILON || hasExplicitAdjustments;
    const segments: ExtractedTextSegment[] = [];

    for (const part of parts) {
      if (typeof part === 'number') {
        cursor += (-(part / 1000) * fontSize) * hScale;
        continue;
      }
      const glyphText = part.unicode ?? '';
      if (!glyphText) {
        cursor += getGlyphWidth(part, fontSize, hScale) + getGlyphSpacing(part, charSpacing, wordSpacing, hScale);
        continue;
      }

      if (!sawGlyph) {
        visibleStart = cursor;
        sawGlyph = true;
      }

      const glyphWidth = getGlyphWidth(part, fontSize, hScale);
      if (preciseSpacing) {
        const glyphOrigin = multiply(textSpaceToViewport, [
          1, 0, 0, 1, cursor, textRise,
        ]);
        segments.push({
          text: glyphText,
          x: glyphOrigin[4],
          y: glyphOrigin[5],
          targetWidth: glyphWidth * baselineScale,
        });
      }

      visibleWidth = cursor + glyphWidth - visibleStart;
      cursor += glyphWidth + getGlyphSpacing(part, charSpacing, wordSpacing, hScale);
    }

    if (!sawGlyph) {
      advanceTextMatrix(cursor);
      return;
    }

    const viewportOrigin = multiply(textSpaceToViewport, [
      1, 0, 0, 1, visibleStart, textRise,
    ]);
    const pdfOrigin = multiply(textSpaceToPdf, [1, 0, 0, 1, visibleStart, 0]);

    runs.push({
      text,
      x: viewportOrigin[4],
      y: viewportOrigin[5],
      pdfX: pdfOrigin[4],
      pdfY: pdfOrigin[5],
      fontName,
      fontHeight,
      targetWidth: visibleWidth * baselineScale,
      angle: Math.atan2(textSpaceToViewport[1], textSpaceToViewport[0]),
      fillColor,
      strokeColor,
      renderingMode,
      segments: preciseSpacing ? segments : undefined,
    });

    advanceTextMatrix(cursor);
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        ctmStack.push({
          ctm: [...ctm] as Matrix,
          textMatrix: [...textMatrix] as Matrix,
          textLineMatrix: [...textLineMatrix] as Matrix,
          fontName,
          fontSize,
          fillColor,
          strokeColor,
          renderingMode,
          leading,
          charSpacing,
          wordSpacing,
          hScale,
          textRise,
        });
        break;
      case OPS.restore: {
        const prev = ctmStack.pop();
        if (!prev) {
          break;
        }
        ctm = prev.ctm;
        textMatrix = prev.textMatrix;
        textLineMatrix = prev.textLineMatrix;
        fontName = prev.fontName;
        fontSize = prev.fontSize;
        fillColor = prev.fillColor;
        strokeColor = prev.strokeColor;
        renderingMode = prev.renderingMode;
        leading = prev.leading;
        charSpacing = prev.charSpacing;
        wordSpacing = prev.wordSpacing;
        hScale = prev.hScale;
        textRise = prev.textRise;
        break;
      }
      case OPS.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case OPS.beginText:
        textMatrix = [1, 0, 0, 1, 0, 0];
        textLineMatrix = [1, 0, 0, 1, 0, 0];
        break;
      case OPS.setTextMatrix:
        textMatrix = [...((args?.[0] as number[]) ?? args)] as Matrix;
        textLineMatrix = [...textMatrix] as Matrix;
        break;
      case OPS.setLeading:
        leading = args?.[0] as number;
        break;
      case OPS.setLeadingMoveText: {
        leading = -(args?.[1] as number);
        const tx = args?.[0] as number;
        const ty = args?.[1] as number;
        textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, tx, ty]);
        textMatrix = [...textLineMatrix] as Matrix;
        break;
      }
      case OPS.moveText: {
        const tx = args?.[0] as number;
        const ty = args?.[1] as number;
        textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, tx, ty]);
        textMatrix = [...textLineMatrix] as Matrix;
        break;
      }
      case OPS.nextLine:
        textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, 0, -leading]);
        textMatrix = [...textLineMatrix] as Matrix;
        break;
      case OPS.setFont:
        fontName = (args?.[0] as string) ?? fontName;
        fontSize = (args?.[1] as number) ?? fontSize;
        break;
      case OPS.setCharSpacing:
        charSpacing = (args?.[0] as number) ?? charSpacing;
        break;
      case OPS.setWordSpacing:
        wordSpacing = (args?.[0] as number) ?? wordSpacing;
        break;
      case OPS.setHScale:
        hScale = ((args?.[0] as number) ?? 100) / 100;
        break;
      case OPS.setTextRise:
        textRise = (args?.[0] as number) ?? textRise;
        break;
      case OPS.setFillRGBColor:
        fillColor = (args?.[0] as string) ?? fillColor;
        break;
      case OPS.setStrokeRGBColor:
        strokeColor = (args?.[0] as string) ?? strokeColor;
        break;
      case OPS.setFillTransparent:
        fillColor = 'transparent';
        break;
      case OPS.setStrokeTransparent:
        strokeColor = 'transparent';
        break;
      case OPS.setTextRenderingMode:
        renderingMode = (args?.[0] as number) ?? TR_FILL;
        break;
      case OPS.showText:
        emitGlyphRun(readGlyphsFromShowTextArg(args?.[0]));
        break;
      case OPS.showSpacedText: {
        const parts = Array.isArray(args?.[0])
          ? (args?.[0] as Array<number | OperatorGlyph>)
          : [];
        emitGlyphRun(parts, true);
        break;
      }
      case OPS.nextLineShowText:
        textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, 0, -leading]);
        textMatrix = [...textLineMatrix] as Matrix;
        emitGlyphRun(readGlyphsFromShowTextArg(args?.[0]));
        break;
      case OPS.nextLineSetSpacingShowText:
        wordSpacing = (args?.[0] as number) ?? wordSpacing;
        charSpacing = (args?.[1] as number) ?? charSpacing;
        textLineMatrix = multiply(textLineMatrix, [1, 0, 0, 1, 0, -leading]);
        textMatrix = [...textLineMatrix] as Matrix;
        emitGlyphRun(readGlyphsFromShowTextArg(args?.[2]));
        break;
      default:
        break;
    }
  }

  return runs;
}

let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  const mctx = measureCanvas.getContext('2d', { willReadFrequently: false });
  if (!mctx) {
    throw new Error('2D context unavailable for text measurement');
  }
  return mctx;
}

// The browser places text's baseline inside a line box using the font's
// hhea/OS-2 metrics — not `fontBoundingBoxAscent`. Calibrate per font family
// by inserting a zero-width inline-block baseline probe in the live document.
// Ratios aren't linear with font size because WebKit rounds baseline to
// device pixels, so we cache the absolute ascent per (family, size) pair.
const ascentCache = new Map<string, number>();
function getCssAscent(
  fontFamily: string,
  fontSize: number,
  fallbackRatio?: number,
): number {
  const key = `${fontFamily}@${fontSize.toFixed(2)}`;
  const cached = ascentCache.get(key);
  if (cached != null) {
    return cached;
  }
  const wrapper = document.createElement('span');
  wrapper.style.cssText = `position:absolute;visibility:hidden;font:${fontSize}px ${fontFamily};line-height:1;white-space:pre`;
  wrapper.textContent = 'Mg';
  const probe = document.createElement('span');
  probe.style.cssText =
    'display:inline-block;width:0;height:0;vertical-align:baseline';
  wrapper.appendChild(probe);
  const host = document.body ?? document.documentElement;
  host.appendChild(wrapper);
  const wrapperRect = wrapper.getBoundingClientRect();
  const probeRect = probe.getBoundingClientRect();
  wrapper.remove();
  const ascent =
    wrapperRect.height > 0
      ? probeRect.bottom - wrapperRect.top
      : fontSize * (fallbackRatio ?? 0.8);
  ascentCache.set(key, ascent);
  return ascent;
}

export async function renderTextLayer(
  ctx: RenderContext,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'pdf-text';
  container.style.position = 'absolute';
  container.style.inset = '0';
  container.style.overflow = 'hidden';
  container.style.userSelect = 'text';
  container.style.lineHeight = '1';

  const content = await ctx.page.getTextContent();
  const items = content.items as (TextItem | { type: string })[];
  const textItems = items.filter((item): item is TextItem => 'str' in item);
  const styles = content.styles as Record<string, TextStyle>;

  const viewportTransform = ctx.viewport.transform as Matrix;

  const opList = await ctx.page.getOperatorList();
  const hasVerticalStyles = Object.values(styles).some((style) => style.vertical);
  const extractedRuns = hasVerticalStyles
    ? []
    : extractTextRuns(
        opList.fnArray as number[],
        opList.argsArray as unknown[],
        viewportTransform,
        styles,
      );
  const events =
    extractedRuns.length > 0
      ? []
      : extractTextEvents(
          opList.fnArray as number[],
          opList.argsArray as unknown[],
          [1, 0, 0, 1, 0, 0],
        );

  // Wait for embedded fonts to be ready so text-width measurement uses the
  // correct glyph metrics for scaleX correction.
  try {
    await document.fonts.ready;
  } catch {
    // best-effort
  }

  const mctx = getMeasureCtx();

  const renderSpan = (
    text: string,
    fontName: string,
    fontHeight: number,
    angle: number,
    x: number,
    y: number,
    targetWidth: number,
    fill: string,
    stroke: string,
    mode: number,
    dir: string,
    allowScaleSingleGlyph = false,
  ) => {
    const style = styles[fontName];
    const fontFamily = `"${fontName}", ${style?.fontFamily ?? 'sans-serif'}`;
    const fallbackAscentRatio =
      style?.ascent && style.ascent > 0
        ? style.ascent
        : style?.descent != null
          ? 1 + style.descent
          : 0.8;

    mctx.font = `${fontHeight}px ${fontFamily}`;
    const measured = mctx.measureText(text);
    const ascent = getCssAscent(
      fontFamily,
      fontHeight,
      fallbackAscentRatio,
    );

    const left = x - (angle === 0 ? 0 : ascent * Math.sin(angle));
    const top = y - (angle === 0 ? ascent : ascent * Math.cos(angle));

    const span = document.createElement('span');
    span.textContent = text;
    span.dir = dir;
    span.style.position = 'absolute';
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = fontFamily;
    span.style.whiteSpace = 'pre';
    span.style.transformOrigin = '0 0';
    span.style.lineHeight = '1';
    span.style.margin = '0';
    span.style.padding = '0';

    if (mode === TR_INVISIBLE) {
      span.style.color = 'transparent';
    } else if (mode === TR_STROKE) {
      span.style.color = 'transparent';
      span.style.webkitTextStroke = `1px ${stroke}`;
    } else if (mode === TR_FILL_STROKE) {
      span.style.color = fill;
      span.style.webkitTextStroke = `1px ${stroke}`;
    } else {
      span.style.color = fill;
    }

    const rotation =
      angle !== 0 ? `rotate(${(angle * 180) / Math.PI}deg) ` : '';
    let scaleX = 1;
    if (targetWidth > 0 && measured.width > 0) {
      const widthDelta = targetWidth - measured.width;
      const spaceCount = text.match(SPACE_PATTERN)?.length ?? 0;
      if (spaceCount > 0 && Math.abs(widthDelta) > 0.01) {
        span.style.wordSpacing = `${widthDelta / spaceCount}px`;
      } else if (allowScaleSingleGlyph || text.length > 1) {
        scaleX = targetWidth / measured.width;
      }
    }
    span.style.transform =
      scaleX !== 1 ? `${rotation}scaleX(${scaleX})` : rotation.trimEnd();

    container.appendChild(span);
  };

  if (extractedRuns.length > 0) {
    for (const run of extractedRuns) {
      const dir = pickDirection(pickNearestTextItem(run, textItems));
      if (run.segments && run.segments.length > 0) {
        for (const segment of run.segments) {
          renderSpan(
            segment.text,
            run.fontName,
            run.fontHeight,
            run.angle,
            segment.x,
            segment.y,
            segment.targetWidth,
            run.fillColor,
            run.strokeColor,
            run.renderingMode,
            dir,
            true,
          );
        }
        continue;
      }
      renderSpan(
        run.text,
        run.fontName,
        run.fontHeight,
        run.angle,
        run.x,
        run.y,
        run.targetWidth,
        run.fillColor,
        run.strokeColor,
        run.renderingMode,
        dir,
      );
    }
    return container;
  }

  for (const item of textItems) {
    if (!item.str) {
      continue;
    }

    const it = item.transform;
    const vt = viewportTransform;
    const m00 = vt[0] * it[0] + vt[2] * it[1];
    const m01 = vt[1] * it[0] + vt[3] * it[1];
    const m10 = vt[0] * it[2] + vt[2] * it[3];
    const m11 = vt[1] * it[2] + vt[3] * it[3];
    const tx = vt[0] * it[4] + vt[2] * it[5] + vt[4];
    const ty = vt[1] * it[4] + vt[3] * it[5] + vt[5];

    const fontHeight = Math.hypot(m10, m11);
    if (fontHeight < 0.1) {
      continue;
    }

    const { fill, stroke, mode } = pickColor(item, events);
    renderSpan(
      item.str,
      item.fontName,
      fontHeight,
      Math.atan2(m01, m00),
      tx,
      ty,
      item.width * Math.hypot(vt[0], vt[1]),
      fill,
      stroke,
      mode,
      item.dir,
    );
  }

  return container;
}
