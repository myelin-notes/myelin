import { OPS } from 'pdfjs-dist';
import { IDENTITY, type Matrix, multiply } from '../transform';
import type { RenderContext } from '../types';

// pdf.js's internal DrawOPS enum (not exported publicly).
const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

interface GraphicsState {
  ctm: Matrix;
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

function initialState(): GraphicsState {
  return {
    ctm: [...IDENTITY] as Matrix,
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

/**
 * Walk a path DrawOPS buffer, emitting SVG path `d` commands in viewport
 * coords (CTM already applied).
 */
function drawOpsToD(data: number[], ctm: Matrix): string {
  let d = '';
  for (let i = 0; i < data.length; ) {
    const op = data[i++];
    switch (op) {
      case DRAW_MOVE: {
        const x = ctm[0] * data[i] + ctm[2] * data[i + 1] + ctm[4];
        const y = ctm[1] * data[i] + ctm[3] * data[i + 1] + ctm[5];
        i += 2;
        d += `M${x} ${y}`;
        break;
      }
      case DRAW_LINE: {
        const x = ctm[0] * data[i] + ctm[2] * data[i + 1] + ctm[4];
        const y = ctm[1] * data[i] + ctm[3] * data[i + 1] + ctm[5];
        i += 2;
        d += `L${x} ${y}`;
        break;
      }
      case DRAW_CURVE: {
        const x1 = ctm[0] * data[i] + ctm[2] * data[i + 1] + ctm[4];
        const y1 = ctm[1] * data[i] + ctm[3] * data[i + 1] + ctm[5];
        const x2 = ctm[0] * data[i + 2] + ctm[2] * data[i + 3] + ctm[4];
        const y2 = ctm[1] * data[i + 2] + ctm[3] * data[i + 3] + ctm[5];
        const x3 = ctm[0] * data[i + 4] + ctm[2] * data[i + 5] + ctm[4];
        const y3 = ctm[1] * data[i + 4] + ctm[3] * data[i + 5] + ctm[5];
        i += 6;
        d += `C${x1} ${y1} ${x2} ${y2} ${x3} ${y3}`;
        break;
      }
      case DRAW_QUAD: {
        const x1 = ctm[0] * data[i] + ctm[2] * data[i + 1] + ctm[4];
        const y1 = ctm[1] * data[i] + ctm[3] * data[i + 1] + ctm[5];
        const x2 = ctm[0] * data[i + 2] + ctm[2] * data[i + 3] + ctm[4];
        const y2 = ctm[1] * data[i + 2] + ctm[3] * data[i + 3] + ctm[5];
        i += 4;
        d += `Q${x1} ${y1} ${x2} ${y2}`;
        break;
      }
      case DRAW_CLOSE:
        d += 'Z';
        break;
      default:
        return d;
    }
  }
  return d;
}

export async function renderPathLayer(
  ctx: RenderContext,
): Promise<SVGSVGElement> {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'pdf-paths');
  svg.setAttribute('width', String(ctx.viewport.width));
  svg.setAttribute('height', String(ctx.viewport.height));
  svg.setAttribute(
    'viewBox',
    `0 0 ${ctx.viewport.width} ${ctx.viewport.height}`,
  );
  svg.style.position = 'absolute';
  svg.style.inset = '0';
  svg.style.pointerEvents = 'none';

  const opList = await ctx.page.getOperatorList();
  const { fnArray, argsArray } = opList;

  const stack: GraphicsState[] = [];
  // Start CTM = viewport transform (flips Y, scales to pixel coords).
  let state: GraphicsState = initialState();
  state.ctm = [...(ctx.viewport.transform as Matrix)] as Matrix;

  let pendingEOFill = false;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push({
          ...state,
          ctm: [...state.ctm] as Matrix,
          dash: [...state.dash],
        });
        break;
      case OPS.restore:
        if (stack.length > 0) {
          state = stack.pop()!;
        }
        break;
      case OPS.transform:
        state.ctm = multiply(state.ctm, args as Matrix);
        break;
      case OPS.setLineWidth:
        state.lineWidth = args[0];
        break;
      case OPS.setDash:
        state.dash = args[0] ?? [];
        state.dashPhase = args[1] ?? 0;
        break;
      case OPS.setLineCap:
        state.lineCap =
          (['butt', 'round', 'square'] as const)[args[0]] ?? 'butt';
        break;
      case OPS.setLineJoin:
        state.lineJoin =
          (['miter', 'round', 'bevel'] as const)[args[0]] ?? 'miter';
        break;
      case OPS.setStrokeRGBColor:
        // pdf.js worker passes a pre-rendered hex string, e.g. "#ff0000".
        state.strokeColor = args[0];
        break;
      case OPS.setFillRGBColor:
        state.fillColor = args[0];
        break;
      case OPS.setStrokeTransparent:
        state.strokeColor = 'transparent';
        break;
      case OPS.setFillTransparent:
        state.fillColor = 'transparent';
        break;
      case OPS.constructPath: {
        // pdf.js worker emits: [paintOp, [pathBuffer | null], minMax | null].
        // pathBuffer is a Float32Array of draw ops (DrawOPS + coords interleaved).
        const paintOp = args[0] as number;
        const outer = args[1] as Array<Float32Array | null>;
        const drawOps = outer?.[0];
        if (!drawOps || !ArrayBuffer.isView(drawOps)) {
          break;
        }
        const d = drawOpsToD(drawOps as unknown as number[], state.ctm);
        if (!d) {
          break;
        }
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path',
        );
        path.setAttribute('d', d);
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
        path.setAttribute('fill', fill ? state.fillColor : 'none');
        if (fill && eo) {
          path.setAttribute('fill-rule', 'evenodd');
        }
        if (stroke) {
          path.setAttribute('stroke', state.strokeColor);
          // Stroke width is transformed by the CTM scale — take average scale.
          const scale = Math.hypot(state.ctm[0], state.ctm[1]);
          path.setAttribute('stroke-width', String(state.lineWidth * scale));
          path.setAttribute('stroke-linecap', state.lineCap);
          path.setAttribute('stroke-linejoin', state.lineJoin);
          if (state.dash.length > 0) {
            path.setAttribute(
              'stroke-dasharray',
              state.dash.map((n) => n * scale).join(' '),
            );
            path.setAttribute(
              'stroke-dashoffset',
              String(state.dashPhase * scale),
            );
          }
        }
        if (state.fillAlpha < 1 && fill) {
          path.setAttribute('fill-opacity', String(state.fillAlpha));
        }
        if (state.strokeAlpha < 1 && stroke) {
          path.setAttribute('stroke-opacity', String(state.strokeAlpha));
        }
        svg.appendChild(path);
        pendingEOFill = false;
        break;
      }
      default:
        break;
    }
  }
  return svg;
}
