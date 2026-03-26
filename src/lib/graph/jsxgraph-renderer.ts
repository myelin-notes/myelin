import JXG from 'jsxgraph';
import type { GraphConfig, GraphInstance } from './types';

// Lanczos approximation of the gamma function
function gamma(z: number): number {
    if (z <= 0 && z === Math.floor(z)) return Infinity;
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    const g = 7;
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    let sum = c[0];
    for (let i = 1; i < g + 2; i++) sum += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * sum;
}

// Build a JS function from an expression string.
// Supports standard math functions + custom ones like gamma.
const mathEnv: Record<string, unknown> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt,
    log: Math.log, ln: Math.log, log2: Math.log2, log10: Math.log10,
    exp: Math.exp, pow: Math.pow,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sign: Math.sign, min: Math.min, max: Math.max,
    PI: Math.PI, E: Math.E,
    gamma,
};
const envNames = Object.keys(mathEnv);
const envValues = Object.values(mathEnv);

function buildMathFn(expr: string): ((x: number) => number) | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const factory = new Function(...envNames, `"use strict"; return function(x) { return ${expr}; };`);
        return factory(...envValues) as (x: number) => number;
    } catch {
        return null;
    }
}

let nextId = 0;

export function createGraphInstance(config: GraphConfig): GraphInstance {
    const dpr = window.devicePixelRatio || 1;

    const id = `__graph_offscreen_${nextId++}`;
    const container = document.createElement('div');
    container.id = id;
    container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;';
    container.style.width = config.width + 'px';
    container.style.height = config.height + 'px';
    document.body.appendChild(container);

    const xMin = config.xMin ?? -10;
    const xMax = config.xMax ?? 10;
    const yMin = config.yMin ?? -7.5;
    const yMax = config.yMax ?? 7.5;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const board = JXG.JSXGraph.initBoard(id, {
        boundingbox: [xMin, yMax, xMax, yMin],
        axis: true,
        showNavigation: false,
        showCopyright: false,
        showInfobox: false,
        pan: { enabled: false } as any,
        zoom: { enabled: false } as any,
        defaultAxes: {
            x: { strokeColor: '#94a3b8', strokeWidth: 1, highlight: false,
                 ticks: { strokeColor: '#cbd5e1', minorTicks: 0 } },
            y: { strokeColor: '#94a3b8', strokeWidth: 1, highlight: false,
                 ticks: { strokeColor: '#cbd5e1', minorTicks: 0 } },
        },
    } as any);

    let curves: unknown[] = [];

    function addCurves(exprs: string[]) {
        for (const expr of exprs) {
            const fn = buildMathFn(expr);
            if (!fn) continue;
            const curve = board.create('functiongraph', [fn], {
                strokeWidth: 2.5,
                strokeColor: '#2563eb',
                highlight: false,
            });
            curves.push(curve);
        }
    }

    if (config.expressions?.length) {
        addCurves(config.expressions);
    }

    return {
        setExpressions(exprs: string[]) {
            for (const c of curves) board.removeObject(c as JXG.GeometryElement);
            curves = [];
            addCurves(exprs);
            board.fullUpdate();
        },

        setBounds(newXMin: number, newYMin: number, newXMax: number, newYMax: number) {
            board.setBoundingBox([newXMin, newYMax, newXMax, newYMin], true);
            board.fullUpdate();
        },

        resize(width: number, height: number) {
            container.style.width = width + 'px';
            container.style.height = height + 'px';
            board.resizeContainer(width, height, false, true);
        },

        async render(): Promise<ImageBitmap> {
            board.fullUpdate();

            const targetW = Math.round(config.width * dpr);
            const targetH = Math.round(config.height * dpr);

            // Grab live SVG from the DOM (avoids base64/atob encoding bugs with unicode)
            const svgEl = container.querySelector('svg');
            if (!svgEl) throw new Error('No SVG in graph container');

            const clone = svgEl.cloneNode(true) as SVGSVGElement;
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            const vb = clone.getAttribute('viewBox')
                || `0 0 ${svgEl.width.baseVal.value} ${svgEl.height.baseVal.value}`;
            clone.setAttribute('viewBox', vb);
            clone.setAttribute('width', String(targetW));
            clone.setAttribute('height', String(targetH));

            const xml = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            try {
                const img = new Image();
                img.src = url;
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = reject;
                });

                // Rasterize explicitly at target resolution via canvas
                const rc = document.createElement('canvas');
                rc.width = targetW;
                rc.height = targetH;
                rc.getContext('2d')!.drawImage(img, 0, 0, targetW, targetH);
                return createImageBitmap(rc);
            } finally {
                URL.revokeObjectURL(url);
            }
        },

        destroy() {
            JXG.JSXGraph.freeBoard(board);
            container.remove();
        },
    };
}
