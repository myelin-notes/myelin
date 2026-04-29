import { OPS } from 'pdfjs-dist';
import { Logger } from '@/lib/logger';
import { type Matrix, multiply } from '../transform';
import type { RenderContext } from '../types';

const logger = new Logger('PdfRendererCanvasLayer');

const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

const IMAGE_KIND_GRAYSCALE = 1;
const IMAGE_KIND_RGB = 2;
const IMAGE_KIND_RGBA = 3;

interface ImageDataLike {
  width: number;
  height: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap | HTMLCanvasElement | HTMLImageElement;
  kind?: number;
}

interface GraphicsState {
  fillColor: string;
  strokeColor: string;
  lineWidth: number;
  fillAlpha: number;
  strokeAlpha: number;
  dash: number[];
  dashPhase: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
}

function initialGfx(): GraphicsState {
  return {
    fillColor: '#000',
    strokeColor: '#000',
    lineWidth: 1,
    fillAlpha: 1,
    strokeAlpha: 1,
    dash: [],
    dashPhase: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
}

function buildPath2D(data: ArrayLike<number>): Path2D {
  const p = new Path2D();
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    if (op === DRAW_MOVE) {
      p.moveTo(data[i], data[i + 1]);
      i += 2;
    } else if (op === DRAW_LINE) {
      p.lineTo(data[i], data[i + 1]);
      i += 2;
    } else if (op === DRAW_CURVE) {
      p.bezierCurveTo(
        data[i],
        data[i + 1],
        data[i + 2],
        data[i + 3],
        data[i + 4],
        data[i + 5],
      );
      i += 6;
    } else if (op === DRAW_QUAD) {
      p.quadraticCurveTo(data[i], data[i + 1], data[i + 2], data[i + 3]);
      i += 4;
    } else if (op === DRAW_CLOSE) {
      p.closePath();
    } else {
      break;
    }
  }
  return p;
}

function imageToCanvas(img: ImageDataLike): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const cctx = canvas.getContext('2d');
  if (!cctx) {
    return null;
  }
  if (img.bitmap) {
    cctx.drawImage(img.bitmap as CanvasImageSource, 0, 0);
    return canvas;
  }
  if (!img.data) {
    return null;
  }
  const out = cctx.createImageData(img.width, img.height);
  const src = img.data;
  const dst = out.data;
  if (img.kind === IMAGE_KIND_GRAYSCALE) {
    for (let i = 0, j = 0; i < src.length; i++, j += 4) {
      dst[j] = src[i];
      dst[j + 1] = src[i];
      dst[j + 2] = src[i];
      dst[j + 3] = 255;
    }
  } else if (
    img.kind === IMAGE_KIND_RGB ||
    src.length === img.width * img.height * 3
  ) {
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      dst[j] = src[i];
      dst[j + 1] = src[i + 1];
      dst[j + 2] = src[i + 2];
      dst[j + 3] = 255;
    }
  } else if (
    img.kind === IMAGE_KIND_RGBA ||
    src.length === img.width * img.height * 4
  ) {
    dst.set(src);
  } else {
    return null;
  }
  cctx.putImageData(out, 0, 0);
  return canvas;
}

function getImageObject(
  page: RenderContext['page'],
  objId: string,
): Promise<ImageDataLike | null> {
  const pool = objId.startsWith('g_') ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      pool.get(objId, (data: ImageDataLike | null) => resolve(data));
    } catch (err) {
      const e = err as { name?: string; message?: string } | null;
      logger.error('Image object fetch failed', {
        objId,
        error: `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`,
      });
      resolve(null);
    }
  });
}

function applyTransform(cctx: CanvasRenderingContext2D, m: Matrix): void {
  cctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function drawImageAt(
  cctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  ctm: Matrix,
): void {
  // PDF image XObjects render into the unit rect (0,0)-(1,1) in PDF user space.
  // pdf.js's worker emits internally `scale(1/w, -1/h)` then full-pixel-size
  // draw, which is equivalent to applying `[1,0,0,-1,0,1]` (Y-flip + bottom
  // anchor) to the CTM and drawing into the unit rect.
  const placement = multiply(ctm, [1, 0, 0, -1, 0, 1] as Matrix);
  cctx.save();
  applyTransform(cctx, placement);
  cctx.drawImage(src, 0, 0, 1, 1);
  cctx.restore();
}

export interface ClipRect {
  /** Top-left in viewport (CSS-px) coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function renderCanvasLayer(
  ctx: RenderContext,
  renderScale = 1,
  clip?: ClipRect,
): Promise<HTMLCanvasElement> {
  const dpr = window.devicePixelRatio || 1;
  const pixelScale = dpr * renderScale;
  const cssW = clip ? clip.width : ctx.viewport.width;
  const cssH = clip ? clip.height : ctx.viewport.height;
  const canvas = document.createElement('canvas');
  canvas.className = 'pdf-canvas';
  canvas.width = Math.ceil(cssW * pixelScale);
  canvas.height = Math.ceil(cssH * pixelScale);
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.pointerEvents = 'none';
  // Promote to its own GPU layer so parent transform: scale only resamples
  // the texture instead of forcing a re-raster.
  canvas.style.willChange = 'transform';
  canvas.style.transform = 'translateZ(0)';

  const cctx = canvas.getContext('2d');
  if (!cctx) {
    return canvas;
  }
  cctx.scale(pixelScale, pixelScale);
  if (clip) {
    // Shift origin so the clip rect's top-left lands at canvas (0, 0).
    cctx.translate(-clip.x, -clip.y);
  }
  // Apply the page viewport transform once on the context. Subsequent CTM
  // updates (relative to the page) compose on top via cctx.save/transform.
  applyTransform(cctx, ctx.viewport.transform as Matrix);

  const opList = await ctx.page.getOperatorList();
  const { fnArray, argsArray } = opList;

  // CTM tracked in JS so we can apply it manually for image draws (which need
  // a fresh save/transform/drawImage/restore around the unit-rect draw).
  // Path draws use the canvas's own transform stack — we save/transform the
  // canvas on entering constructPath, draw, then restore.
  const stack: Array<{ ctm: Matrix; gfx: GraphicsState }> = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let gfx = initialGfx();
  let pendingEOFill = false;

  const imageCache = new Map<string, HTMLCanvasElement | null>();
  async function resolveImage(
    objId: string,
  ): Promise<HTMLCanvasElement | null> {
    if (imageCache.has(objId)) {
      return imageCache.get(objId) ?? null;
    }
    const img = await getImageObject(ctx.page, objId);
    const c = img ? imageToCanvas(img) : null;
    imageCache.set(objId, c);
    return c;
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push({
          ctm: [...ctm] as Matrix,
          gfx: { ...gfx, dash: [...gfx.dash] },
        });
        cctx.save();
        break;
      case OPS.restore:
        if (stack.length > 0) {
          const top = stack.pop()!;
          ctm = top.ctm;
          gfx = top.gfx;
        }
        cctx.restore();
        break;
      case OPS.transform: {
        const m = args as Matrix;
        ctm = multiply(ctm, m);
        applyTransform(cctx, m);
        break;
      }
      case OPS.setLineWidth:
        gfx.lineWidth = args[0];
        break;
      case OPS.setDash:
        gfx.dash = args[0] ?? [];
        gfx.dashPhase = args[1] ?? 0;
        break;
      case OPS.setLineCap:
        gfx.lineCap = (['butt', 'round', 'square'] as const)[args[0]] ?? 'butt';
        break;
      case OPS.setLineJoin:
        gfx.lineJoin =
          (['miter', 'round', 'bevel'] as const)[args[0]] ?? 'miter';
        break;
      case OPS.setStrokeRGBColor:
        gfx.strokeColor = args[0];
        break;
      case OPS.setFillRGBColor:
        gfx.fillColor = args[0];
        break;
      case OPS.setStrokeTransparent:
        gfx.strokeColor = 'transparent';
        break;
      case OPS.setFillTransparent:
        gfx.fillColor = 'transparent';
        break;
      case OPS.constructPath: {
        const paintOp = args[0] as number;
        const outer = args[1] as Array<Float32Array | null>;
        const drawOps = outer?.[0];
        if (!drawOps || !ArrayBuffer.isView(drawOps)) {
          break;
        }
        const path = buildPath2D(drawOps as unknown as ArrayLike<number>);
        const stroke =
          paintOp === OPS.stroke ||
          paintOp === OPS.closeStroke ||
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke;
        const fill =
          paintOp === OPS.fill ||
          paintOp === OPS.eoFill ||
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke ||
          paintOp === OPS.closeFillStroke ||
          paintOp === OPS.closeEOFillStroke;
        const eo =
          paintOp === OPS.eoFill ||
          paintOp === OPS.eoFillStroke ||
          paintOp === OPS.closeEOFillStroke ||
          pendingEOFill;
        if (fill && gfx.fillColor !== 'transparent') {
          cctx.save();
          cctx.fillStyle = gfx.fillColor;
          cctx.globalAlpha = gfx.fillAlpha;
          cctx.fill(path, eo ? 'evenodd' : 'nonzero');
          cctx.restore();
        }
        if (stroke && gfx.strokeColor !== 'transparent') {
          cctx.save();
          cctx.strokeStyle = gfx.strokeColor;
          cctx.globalAlpha = gfx.strokeAlpha;
          cctx.lineWidth = gfx.lineWidth;
          cctx.lineCap = gfx.lineCap;
          cctx.lineJoin = gfx.lineJoin;
          if (gfx.dash.length > 0) {
            cctx.setLineDash(gfx.dash);
            cctx.lineDashOffset = gfx.dashPhase;
          }
          cctx.stroke(path);
          cctx.restore();
        }
        pendingEOFill = false;
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        const img =
          fn === OPS.paintInlineImageXObject
            ? imageToCanvas(args[0] as ImageDataLike)
            : await resolveImage(args[0] as string);
        if (!img) {
          break;
        }
        drawImageAt(cctx, img, ctm);
        break;
      }
      case OPS.paintImageXObjectRepeat: {
        const img = await resolveImage(args[0] as string);
        if (!img) {
          break;
        }
        const sX = args[1] as number;
        const sY = args[2] as number;
        const positions = args[3] as number[];
        for (let p = 0; p < positions.length; p += 2) {
          const local: Matrix = [sX, 0, 0, sY, positions[p], positions[p + 1]];
          drawImageAt(cctx, img, multiply(ctm, local));
        }
        break;
      }
      default:
        break;
    }
  }

  return canvas;
}
