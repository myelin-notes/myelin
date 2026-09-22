import { getScratchCanvasContext } from '../scratch-canvas';

/** Upload premultiplied pixels; oversized sources retain their original dimensions for cropping/export. */
export function uploadImageTexture(
  gl: WebGL2RenderingContext,
  image: ImageBitmap,
  maxSize: number,
): void {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  if (scale === 1) {
    // ImageBitmap uploads use the decode's premultiplyAlpha option, not pixelStorei.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return;
  }
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));
  const scratch = getScratchCanvasContext(width, height);
  try {
    scratch.context.imageSmoothingQuality = 'high';
    scratch.context.drawImage(image, 0, 0, width, height);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      scratch.canvas,
    );
  } finally {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    scratch.release();
  }
}
