import { parseCssColor } from '../pdf-export/color';
import { uploadImageTexture } from './image-texture';
import { RenderPath } from './path';
import { type Program, WebGLSurface } from './surface';
import { strokeContours, tessellate } from './tessellate';

export type DrawingContext = CanvasRenderingContext2D | WebGLPainter;

interface PaintState {
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineDashOffset: number;
  dash: number[];
  transform: [number, number, number, number];
}

interface Mesh {
  buffer: WebGLBuffer;
  count: number;
  origin: Point;
  lastFrame: number;
}

interface ImageTexture {
  texture: WebGLTexture;
  lastFrame: number;
}

interface Point {
  x: number;
  y: number;
}

const VERTEX = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_size;
uniform vec4 u_transform;
out vec2 uv;
void main() {
  vec2 p = a_position * u_transform.xy + u_transform.zw;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  uv = a_uv;
}`;
const FILL = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 color;
void main() { color = vec4(u_color.rgb * u_color.a, u_color.a); }`;
const IMAGE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_alpha;
in vec2 uv;
out vec4 color;
void main() {
  vec4 sampleColor = texture(u_image, uv);
  color = sampleColor * u_alpha;
}`;

function initialState(): PaintState {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDashOffset: 0,
    dash: [],
    transform: [1, 1, 0, 0],
  };
}

/** The editor's live drawing subset. Geometry and textures are retained across frames. */
export class WebGLPainter {
  private readonly surface: WebGLSurface;
  private state = initialState();
  private readonly stack: PaintState[] = [];
  private path = new RenderPath();
  private readonly meshes = new Map<RenderPath | string, Mesh>();
  private readonly textures = new Map<ImageBitmap, ImageTexture>();
  private fillProgram!: Program;
  private imageProgram!: Program;
  private imageBuffer!: WebGLBuffer;
  private generation = -1;
  private frame = 0;
  private dpr = 1;
  private maxTextureSize = 0;
  private drawing = false;
  private hasContents = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.surface = new WebGLSurface(canvas);
    if (canvas.clientWidth && canvas.clientHeight) {
      this.surface.resize(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio || 1,
      );
    }
  }

  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(value: string) {
    this.state.fillStyle = value;
  }
  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: string) {
    this.state.strokeStyle = value;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    this.state.globalAlpha = value;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }
  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }
  set lineCap(value: CanvasLineCap) {
    this.state.lineCap = value;
  }
  get lineJoin(): CanvasLineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(value: CanvasLineJoin) {
    this.state.lineJoin = value;
  }
  get lineDashOffset(): number {
    return this.state.lineDashOffset;
  }
  set lineDashOffset(value: number) {
    this.state.lineDashOffset = value;
  }

  beginFrame(width: number, height: number, dpr: number): boolean {
    const surface = this.surface;
    surface.resize(width, height, dpr);
    if (surface.gl.isContextLost()) {
      return false;
    }
    this.drawing = false;
    this.dpr = dpr;
    this.frame++;
    if (this.generation !== surface.generation) {
      this.hasContents = false;
      this.meshes.clear();
      this.textures.clear();
      this.fillProgram = surface.program(VERTEX, FILL, [
        'u_size',
        'u_transform',
        'u_color',
      ]);
      this.imageProgram = surface.program(VERTEX, IMAGE, [
        'u_size',
        'u_transform',
        'u_image',
        'u_alpha',
      ]);
      this.imageBuffer = surface.gl.createBuffer()!;
      this.maxTextureSize = surface.gl.getParameter(
        surface.gl.MAX_TEXTURE_SIZE,
      );
      this.generation = surface.generation;
    }
    this.state = initialState();
    this.stack.length = 0;
    return true;
  }

  resize(width: number, height: number, dpr: number): void {
    this.surface.resize(width, height, dpr);
  }

  endFrame(): void {
    if (!this.drawing && this.hasContents) {
      this.surface.begin();
      this.hasContents = false;
    }
    const gl = this.surface.gl;
    for (const [key, mesh] of this.meshes) {
      if (this.frame - mesh.lastFrame > (typeof key === 'string' ? 2 : 120)) {
        gl.deleteBuffer(mesh.buffer);
        this.meshes.delete(key);
      }
    }
    for (const [key, texture] of this.textures) {
      if (this.frame - texture.lastFrame > 120) {
        gl.deleteTexture(texture.texture);
        this.textures.delete(key);
      }
    }
  }

  save(): void {
    this.stack.push({ ...this.state, transform: [...this.state.transform] });
  }
  restore(): void {
    const state = this.stack.pop();
    if (state) {
      this.state = state;
    }
  }
  scale(x: number, y: number): void {
    this.state.transform[0] *= x;
    this.state.transform[1] *= y;
  }
  translate(x: number, y: number): void {
    this.state.transform[2] += x * this.state.transform[0];
    this.state.transform[3] += y * this.state.transform[1];
  }
  setLineDash(dash: number[]): void {
    this.state.dash = [...dash];
  }
  beginPath(): void {
    this.path = new RenderPath();
  }
  moveTo(x: number, y: number): void {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.path.lineTo(x, y);
  }
  closePath(): void {
    this.path.closePath();
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    this.path.quadraticCurveTo(cx, cy, x, y);
  }
  bezierCurveTo(
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    y: number,
  ): void {
    this.path.bezierCurveTo(a, b, c, d, x, y);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.path.rect(x, y, w, h);
  }
  roundRect(x: number, y: number, w: number, h: number, radius: number): void {
    this.path.roundRect(x, y, w, h, radius);
  }
  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.path.arc(x, y, radius, start, end);
  }
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void {
    this.path.ellipse(x, y, rx, ry, rotation, start, end);
  }

  fill(): void {
    this.drawPath(this.path, JSON.stringify(this.path.contours), false);
  }

  /** Treat the supplied path as immutable; a changed stroke must supply a new path. */
  fillPath(path: RenderPath): void {
    this.drawPath(path, path, false);
  }

  stroke(): void {
    const key = JSON.stringify([
      this.path.contours,
      this.lineWidth,
      this.lineCap,
      this.lineJoin,
      this.state.dash,
      this.lineDashOffset,
    ]);
    this.drawPath(this.path, key, true);
  }

  private drawPath(
    path: RenderPath,
    key: RenderPath | string,
    stroke: boolean,
  ): void {
    const gl = this.surface.gl;
    let mesh = this.meshes.get(key);
    if (!mesh) {
      const contours = stroke
        ? strokeContours(path.contours, {
            width: this.lineWidth,
            cap: this.lineCap,
            join: this.lineJoin,
            dash: this.state.dash,
            dashOffset: this.lineDashOffset,
          })
        : path.contours;
      const vertices = tessellate(contours);
      const origin = { x: vertices[0] ?? 0, y: vertices[1] ?? 0 };
      const localVertices = new Float32Array(vertices.length);
      for (let i = 0; i < vertices.length; i += 2) {
        localVertices[i] = vertices[i] - origin.x;
        localVertices[i + 1] = vertices[i + 1] - origin.y;
      }
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, localVertices, gl.STATIC_DRAW);
      mesh = {
        buffer,
        count: localVertices.length / 2,
        origin,
        lastFrame: this.frame,
      };
      this.meshes.set(key, mesh);
    }
    mesh.lastFrame = this.frame;
    if (!mesh.count) {
      return;
    }
    this.use(this.fillProgram, mesh.origin);
    const { rgb, opacity } = parseCssColor(
      stroke ? this.strokeStyle : this.fillStyle,
    );
    gl.uniform4f(
      this.fillProgram.uniforms.u_color,
      rgb[0] / 255,
      rgb[1] / 255,
      rgb[2] / 255,
      opacity * this.globalAlpha,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  drawImage(
    image: ImageBitmap,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  drawImage(image: ImageBitmap, ...args: number[]): void {
    const [sx, sy, sw, sh, dx, dy, dw, dh] =
      args.length === 2
        ? [
            0,
            0,
            image.width,
            image.height,
            args[0],
            args[1],
            image.width,
            image.height,
          ]
        : args;
    if (!image.width || !image.height || !sw || !sh) {
      return;
    }
    const gl = this.surface.gl;
    let cached = this.textures.get(image);
    if (!cached) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      uploadImageTexture(gl, image, this.maxTextureSize);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      cached = { texture, lastFrame: this.frame };
      this.textures.set(image, cached);
    }
    cached.lastFrame = this.frame;
    this.use(this.imageProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    gl.uniform1i(this.imageProgram.uniforms.u_image, 0);
    gl.uniform1f(this.imageProgram.uniforms.u_alpha, this.globalAlpha);
    const u0 = sx / image.width,
      v0 = sy / image.height,
      u1 = (sx + sw) / image.width,
      v1 = (sy + sh) / image.height;
    const vertices = new Float32Array([
      dx,
      dy,
      u0,
      v0,
      dx + dw,
      dy,
      u1,
      v0,
      dx,
      dy + dh,
      u0,
      v1,
      dx,
      dy + dh,
      u0,
      v1,
      dx + dw,
      dy,
      u1,
      v0,
      dx + dw,
      dy + dh,
      u1,
      v1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private use(program: Program, origin: Point = { x: 0, y: 0 }): void {
    if (!this.drawing) {
      this.surface.begin();
      this.drawing = true;
      this.hasContents = true;
    }
    const gl = this.surface.gl;
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook.
    gl.useProgram(program.handle);
    gl.uniform2f(
      program.uniforms.u_size,
      this.canvas.width / this.dpr,
      this.canvas.height / this.dpr,
    );
    const [scaleX, scaleY, translateX, translateY] = this.state.transform;
    gl.uniform4fv(program.uniforms.u_transform, [
      scaleX,
      scaleY,
      translateX + origin.x * scaleX,
      translateY + origin.y * scaleY,
    ]);
  }

  destroy(): void {
    const gl = this.surface.gl;
    for (const mesh of this.meshes.values()) {
      gl.deleteBuffer(mesh.buffer);
    }
    for (const texture of this.textures.values()) {
      gl.deleteTexture(texture.texture);
    }
    if (this.imageBuffer) {
      gl.deleteBuffer(this.imageBuffer);
    }
    this.meshes.clear();
    this.textures.clear();
    this.surface.destroy();
  }
}
