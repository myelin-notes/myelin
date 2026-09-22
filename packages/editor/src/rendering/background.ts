import { parseCssColor } from '../pdf-export/color';
import { type Program, WebGLSurface } from './surface';

export type CanvasBackground = 'grid' | 'dots' | 'blank';

export function gridPhase(offset: number, zoom: number): number {
  const tile = 24 * zoom;
  return (((offset * zoom) % tile) + tile) % tile;
}

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_phase;
uniform float u_height;
uniform float u_dpr;
uniform float u_zoom;
uniform float u_dots;
uniform vec4 u_color;
out vec4 color;
void main() {
  vec2 screen = vec2(gl_FragCoord.x, u_height - gl_FragCoord.y) / u_dpr;
  float tile = 24.0 * u_zoom;
  vec2 p = screen - u_phase - vec2(u_dots * tile * 0.5);
  vec2 distanceToGrid = abs(mod(p + tile * 0.5, tile) - tile * 0.5);
  float distanceToEdge = u_dots > 0.5
    ? length(distanceToGrid) - 0.75 * u_zoom
    : min(distanceToGrid.x, distanceToGrid.y) - 0.25 * u_zoom;
  float aa = 0.5 / u_dpr;
  float coverage = 1.0 - smoothstep(-aa, aa, distanceToEdge);
  float subpixelCoverage = u_dots > 0.5
    ? min(1.0, 3.14159265 * pow(0.75 * u_zoom * u_dpr, 2.0))
    : min(1.0, 0.5 * u_zoom * u_dpr);
  float alpha = u_color.a * coverage * subpixelCoverage;
  color = vec4(u_color.rgb * alpha, alpha);
}`;

export class BackgroundRenderer {
  private readonly surface: WebGLSurface;
  private program: Program | null = null;
  private generation = -1;
  private lastFrame = '';

  constructor(canvas: HTMLCanvasElement) {
    this.surface = new WebGLSurface(canvas, { antialias: false });
  }

  draw(
    width: number,
    height: number,
    dpr: number,
    zoom: number,
    x: number,
    y: number,
    style: CanvasBackground,
    color: string,
  ): void {
    const surface = this.surface;
    if (surface.gl.isContextLost()) {
      return;
    }
    surface.resize(width, height, dpr);
    const key = [
      width,
      height,
      dpr,
      zoom,
      x,
      y,
      style,
      color,
      surface.generation,
    ].join('|');
    if (key === this.lastFrame) {
      return;
    }
    if (!surface.begin()) {
      return;
    }
    if (this.generation !== surface.generation) {
      this.program = surface.program(VERTEX, FRAGMENT, [
        'u_phase',
        'u_height',
        'u_dpr',
        'u_zoom',
        'u_dots',
        'u_color',
      ]);
      this.generation = surface.generation;
    }
    this.lastFrame = key;
    if (style === 'blank') {
      return;
    }
    const gl = surface.gl,
      program = this.program!;
    const parsed = parseCssColor(color);
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL API, not a React hook.
    gl.useProgram(program.handle);
    gl.uniform2f(
      program.uniforms.u_phase,
      gridPhase(x, zoom),
      gridPhase(y, zoom),
    );
    gl.uniform1f(program.uniforms.u_height, surface.canvas.height);
    gl.uniform1f(program.uniforms.u_dpr, dpr);
    gl.uniform1f(program.uniforms.u_zoom, zoom);
    gl.uniform1f(program.uniforms.u_dots, style === 'dots' ? 1 : 0);
    gl.uniform4f(
      program.uniforms.u_color,
      parsed.rgb[0] / 255,
      parsed.rgb[1] / 255,
      parsed.rgb[2] / 255,
      parsed.opacity,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.surface.destroy();
  }
}
