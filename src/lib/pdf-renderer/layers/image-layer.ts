import { OPS } from 'pdfjs-dist';
import { Logger } from '@/lib/logger';
import { type Matrix, multiply, toCssMatrix } from '../transform';
import type { RenderContext } from '../types';

const logger = new Logger('PdfRendererImageLayer');

interface ImageDataLike {
  width: number;
  height: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap | HTMLCanvasElement | HTMLImageElement;
  kind?: number;
}

const IMAGE_KIND_GRAYSCALE = 1;
const IMAGE_KIND_RGB = 2;
const IMAGE_KIND_RGBA = 3;

function imageToBlobUrl(img: ImageDataLike): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const cctx = canvas.getContext('2d');
  if (!cctx) {
    return null;
  }

  if (img.bitmap) {
    cctx.drawImage(img.bitmap as CanvasImageSource, 0, 0);
  } else if (img.data) {
    const out = cctx.createImageData(img.width, img.height);
    const src = img.data;
    const dst = out.data;
    if (img.kind === IMAGE_KIND_GRAYSCALE) {
      for (let i = 0, j = 0; i < src.length; i++, j += 4) {
        dst[j] = dst[j + 1] = dst[j + 2] = src[i];
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
  } else {
    return null;
  }
  return canvas.toDataURL('image/png');
}

function getImageObject(
  page: RenderContext['page'],
  objId: string,
): Promise<ImageDataLike | null> {
  // pdf.js streams image data asynchronously — not all objects are
  // resolved by the time getOperatorList() returns. Use the callback form
  // of `get` which fires when the object lands.
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

export async function renderImageLayer(
  ctx: RenderContext,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'pdf-images';
  container.style.position = 'absolute';
  container.style.inset = '0';
  container.style.overflow = 'hidden';
  container.style.pointerEvents = 'none';

  const opList = await ctx.page.getOperatorList();
  const { fnArray, argsArray } = opList;

  const stack: Matrix[] = [];
  let ctm: Matrix = [...(ctx.viewport.transform as Matrix)] as Matrix;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) {
      stack.push([...ctm] as Matrix);
    } else if (fn === OPS.restore) {
      if (stack.length > 0) {
        ctm = stack.pop()!;
      }
    } else if (fn === OPS.transform) {
      ctm = multiply(ctm, args as Matrix);
    } else if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject
    ) {
      const img =
        fn === OPS.paintInlineImageXObject
          ? (args[0] as ImageDataLike)
          : await getImageObject(ctx.page, args[0] as string);
      if (!img) {
        continue;
      }
      const url = imageToBlobUrl(img);
      if (!url) {
        continue;
      }
      // Image is drawn into the unit rect (0,0)-(1,1) in PDF space; the CTM
      // contains the actual placement and size. pdf.js applies an internal
      // `scale(1/w, -1/h)` then draws at full pixel size — equivalent to
      // applying the CTM to the unit rect directly with a Y-flip.
      const placement = multiply(ctm, [1, 0, 0, -1, 0, 1] as Matrix);
      const el = document.createElement('img');
      el.src = url;
      el.draggable = false;
      el.style.position = 'absolute';
      el.style.left = '0';
      el.style.top = '0';
      el.style.width = '1px';
      el.style.height = '1px';
      el.style.transformOrigin = '0 0';
      el.style.transform = toCssMatrix(placement);
      container.appendChild(el);
    } else if (fn === OPS.paintImageXObjectRepeat) {
      const img = await getImageObject(ctx.page, args[0] as string);
      if (!img) {
        continue;
      }
      const url = imageToBlobUrl(img);
      if (!url) {
        continue;
      }
      const scaleX = args[1] as number;
      const scaleY = args[2] as number;
      const positions = args[3] as number[];
      for (let p = 0; p < positions.length; p += 2) {
        const local: Matrix = [
          scaleX,
          0,
          0,
          scaleY,
          positions[p],
          positions[p + 1],
        ];
        const placement = multiply(multiply(ctm, local), [
          1, 0, 0, -1, 0, 1,
        ] as Matrix);
        const el = document.createElement('img');
        el.src = url;
        el.draggable = false;
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.transformOrigin = '0 0';
        el.style.transform = toCssMatrix(placement);
        container.appendChild(el);
      }
    }
  }
  return container;
}
