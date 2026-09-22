import { describe, expect, it, vi } from 'vitest';
import { WebGLPainter } from './painter';
import { RenderPath } from './path';

const { scratch } = vi.hoisted(() => ({
  scratch: {
    canvas: {},
    context: { drawImage: vi.fn(), imageSmoothingQuality: 'low' },
    release: vi.fn(),
  },
}));

vi.mock('../scratch-canvas', () => ({
  getScratchCanvasContext: () => scratch,
}));

function createSurface() {
  const gl = {
    ARRAY_BUFFER: 34962,
    STATIC_DRAW: 35044,
    STREAM_DRAW: 35040,
    TRIANGLES: 4,
    FLOAT: 5126,
    COLOR_BUFFER_BIT: 16384,
    BLEND: 3042,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 771,
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    LINEAR: 9729,
    LINEAR_MIPMAP_LINEAR: 9987,
    CLAMP_TO_EDGE: 33071,
    MAX_TEXTURE_SIZE: 3379,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37440,
    getParameter: vi.fn(() => 4096),
    pixelStorei: vi.fn(),
    isContextLost: vi.fn(() => false),
    createShader: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getUniformLocation: vi.fn((_program: unknown, name: string) => name),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteTexture: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    useProgram: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniform4fv: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    disableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    drawArrays: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    generateMipmap: vi.fn(),
    activeTexture: vi.fn(),
  };
  const target = new EventTarget();
  const canvas = Object.assign(target, {
    width: 0,
    height: 0,
    getContext: vi.fn(() => gl),
  }) as unknown as HTMLCanvasElement;
  return { gl, canvas, painter: new WebGLPainter(canvas) };
}

describe('WebGLPainter resource lifecycle', () => {
  it('downsamples oversized image uploads without changing crop coordinates', () => {
    const { gl, painter } = createSurface();
    const image = { width: 8192, height: 4096 } as ImageBitmap;
    painter.beginFrame(800, 600, 1);
    painter.drawImage(image, 4096, 0, 4096, 4096, 0, 0, 100, 100);
    expect(scratch.context.drawImage).toHaveBeenLastCalledWith(
      image,
      0,
      0,
      4096,
      2048,
    );
    expect(gl.texImage2D.mock.calls[0][5]).toBe(scratch.canvas);
    expect(gl.pixelStorei).toHaveBeenLastCalledWith(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
      false,
    );
    expect(scratch.release).toHaveBeenCalled();
    const vertices = gl.bufferData.mock.calls.at(-1)![1] as Float32Array;
    expect(vertices[2]).toBe(0.5);
    painter.destroy();
  });
  it('reuses completed geometry through pan, zoom, and color changes', () => {
    const { gl, painter, canvas } = createSurface();
    const path = new RenderPath();
    path.rect(0, 0, 10, 10);
    painter.beginFrame(800, 600, 2);
    painter.fillPath(path);
    painter.endFrame();
    painter.beginFrame(800, 600, 2);
    painter.scale(2, 2);
    painter.translate(5, 7);
    painter.fillStyle = '#ff000080';
    painter.fillPath(path);
    painter.endFrame();
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    expect(gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(gl.uniform4fv).toHaveBeenLastCalledWith(
      'u_transform',
      [2, 2, 30, 14],
    );
    expect(gl.uniform4f).toHaveBeenLastCalledWith(
      'u_color',
      1,
      0,
      0,
      128 / 255,
    );
    expect([canvas.width, canvas.height]).toEqual([1600, 1200]);
    painter.destroy();
  });

  it('restores transforms and paint state after element drawing', () => {
    const { gl, painter } = createSurface();
    painter.beginFrame(800, 600, 1);
    painter.scale(2, 2);
    painter.save();
    painter.translate(5, 7);
    painter.globalAlpha = 0.2;
    painter.restore();
    painter.beginPath();
    painter.rect(0, 0, 10, 10);
    painter.fill();
    expect(gl.uniform4fv).toHaveBeenLastCalledWith(
      'u_transform',
      [2, 2, 20, 0],
    );
    expect(gl.uniform4f).toHaveBeenLastCalledWith('u_color', 0, 0, 0, 1);
    painter.destroy();
  });

  it('uploads an image once while changing its crop and opacity', () => {
    const { gl, painter } = createSurface();
    const image = { width: 100, height: 80 } as ImageBitmap;
    painter.beginFrame(800, 600, 1);
    painter.drawImage(image, 0, 0);
    painter.globalAlpha = 0.5;
    painter.drawImage(image, 20, 10, 40, 30, 0, 0, 40, 30);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(gl.uniform1f).toHaveBeenLastCalledWith('u_alpha', 0.5);
    const vertices = gl.bufferData.mock.calls.at(-1)![1] as Float32Array;
    expect(vertices[2]).toBeCloseTo(0.2);
    expect(vertices[3]).toBeCloseTo(0.125);
    expect(vertices[6]).toBeCloseTo(0.6);
    painter.destroy();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  });

  it('recreates GPU resources after context restoration and releases them on teardown', () => {
    const { gl, canvas, painter } = createSurface();
    const path = new RenderPath();
    path.rect(0, 0, 10, 10);
    painter.beginFrame(800, 600, 1);
    painter.fillPath(path);
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    gl.isContextLost.mockReturnValue(true);
    expect(painter.beginFrame(800, 600, 1)).toBe(false);
    gl.isContextLost.mockReturnValue(false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    painter.beginFrame(800, 600, 1);
    painter.fillPath(path);
    expect(gl.bufferData).toHaveBeenCalledTimes(2);
    expect(gl.createProgram).toHaveBeenCalledTimes(4);
    painter.destroy();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  });

  it('keeps large world-coordinate paths precise in their local mesh', () => {
    const { gl, painter } = createSurface();
    const path = new RenderPath();
    path.rect(1e10, 1e10, 10, 10);
    painter.beginFrame(800, 600, 1);
    painter.translate(-1e10, -1e10);
    painter.fillPath(path);
    const vertices = gl.bufferData.mock.calls[0][1] as Float32Array;
    const transform = gl.uniform4fv.mock.calls.at(-1)![1] as number[];
    expect([...vertices].every((value) => Math.abs(value) <= 10)).toBe(true);
    expect(Math.abs(transform[2])).toBeLessThanOrEqual(10);
    expect(Math.abs(transform[3])).toBeLessThanOrEqual(10);
    painter.destroy();
  });
});
