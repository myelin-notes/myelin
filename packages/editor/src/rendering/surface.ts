export interface Program {
  handle: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export interface WebGLSurfaceOptions {
  antialias?: boolean;
}

export class WebGLSurface {
  readonly gl: WebGL2RenderingContext;
  generation = 0;
  private readonly programs = new Set<WebGLProgram>();

  constructor(
    readonly canvas: HTMLCanvasElement,
    { antialias = true }: WebGLSurfaceOptions = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias,
      depth: false,
      stencil: false,
    });
    if (!gl) {
      throw new Error('WebGL 2 is required to render the canvas.');
    }
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  private readonly onLost = (event: Event): void => {
    event.preventDefault();
  };
  private readonly onRestored = (): void => {
    this.programs.clear();
    this.generation++;
  };

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== w) {
      this.canvas.width = w;
    }
    if (this.canvas.height !== h) {
      this.canvas.height = h;
    }
  }

  begin(): boolean {
    const gl = this.gl;
    if (gl.isContextLost()) {
      return false;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  program(vertex: string, fragment: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`WebGL shader: ${message}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vertex);
    let fs: WebGLShader;
    try {
      fs = compile(gl.FRAGMENT_SHADER, fragment);
    } catch (error) {
      gl.deleteShader(vs);
      throw error;
    }
    const handle = gl.createProgram()!;
    gl.attachShader(handle, vs);
    gl.attachShader(handle, fs);
    gl.linkProgram(handle);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(handle);
      gl.deleteProgram(handle);
      throw new Error(`WebGL program: ${message}`);
    }
    this.programs.add(handle);
    return {
      handle,
      uniforms: Object.fromEntries(
        uniforms.map((name) => [name, gl.getUniformLocation(handle, name)]),
      ),
    };
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    for (const program of this.programs) {
      this.gl.deleteProgram(program);
    }
    this.programs.clear();
    if (!this.gl.isContextLost()) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }
}
