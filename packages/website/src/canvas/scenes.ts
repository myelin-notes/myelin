import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { ImageElement } from '@myelin/editor/elements/image-element';
import { PageFrameElement } from '@myelin/editor/elements/page-frame-element';
import { PdfElement } from '@myelin/editor/elements/pdf-element';
import { ShapeElement } from '@myelin/editor/elements/shape-element';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import { TextElement } from '@myelin/editor/elements/text/element';
import { ensureDisplayFont } from '@myelin/editor/google-fonts';
import { writeMarkdownToPageFrameFragment } from '@myelin/editor/page-frame/markdown/import';
import { getPdfPageSizes } from '@myelin/editor/pdf-renderer';
import type { SceneId, SiteCopy } from '@/content/site';

/** Plain world-space rect (DOMRect is constructed lazily, client-side only). */
export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneDef {
  id: SceneId;
  rect: WorldRect;
}

/** Shared content inset used by both canvas builders and DOM overlays. */
export const SCENE_PAD = 90;

const SCENE_GAP = 700;

// Each scene's world-space top (`y`). Because the auto-`x` loop always places
// the next scene's left edge past the previous scene's right edge (via
// SCENE_GAP), no two scenes can overlap regardless of height, so `y` is free to
// vary as widely as we like. The values below span a deliberately tall band and
// wander in irregular steps, with short runs in the same direction (drift down,
// then down again; jump up, then further up) instead of a strict up/down/up/down
// alternation. That forces the camera into steep, diagonal pans between scenes
// so the site reads as a 2D space you move through, not a flat horizontal strip.
const SIZES: Array<{
  id: SceneId;
  w: number;
  h: number;
  y: number;
}> = [
  { id: 'hero', w: 2000, h: 1000, y: 600 },
  { id: 'ink', w: 2250, h: 1180, y: 1500 },
  { id: 'pages', w: 1900, h: 1140, y: 1350 },
  { id: 'audio-search', w: 1900, h: 1000, y: 180 },
  { id: 'linked', w: 1750, h: 800, y: -150 },
  { id: 'sync', w: 1950, h: 1150, y: 900 },
  { id: 'local-first', w: 1850, h: 850, y: 1850 },
  { id: 'import', w: 1700, h: 900, y: 2500 },
  { id: 'download', w: 2100, h: 1400, y: 1400 },
];

/** Scenes laid out left-to-right with a varied vertical rhythm (see SIZES). */
export const SCENES: SceneDef[] = (() => {
  let x = 0;
  return SIZES.map((s) => {
    const def: SceneDef = {
      id: s.id,
      rect: { x, y: s.y, width: s.w, height: s.h },
    };
    x += s.w + SCENE_GAP;
    return def;
  });
})();

export function sceneById(id: SceneId): SceneDef {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) {
    throw new Error(`Unknown scene: ${id}`);
  }
  return scene;
}

const INK = '#191c1e';
const MUTED = '#59646b';
const BLUE = '#3b82f6';
const PINK = '#ec4899';
const ORANGE = '#f97316';
const GREEN = '#16a34a';
const HIGHLIGHT = 'rgba(250, 204, 21, 0.3)';
/** Handwritten annotations; self-hosted @font-face in global.css. */
const HAND_FONT = 'Caveat';
/** Body copy matches the app UI font (shipped by @myelin/ui). */
const SANS_FONT = 'Hanken Grotesk';
/** Headlines match the page-frame heading serif (shipped by @myelin/ui). */
const DISPLAY_FONT = 'Newsreader';

type Pt = [number, number];

interface TextOpts {
  size?: number;
  color?: string;
  width?: number;
  font?: string;
}

function addText(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  content: string,
  opts: TextOpts = {},
): TextElement {
  const el = canvas.addElement(
    (uuid) =>
      new TextElement(
        uuid,
        content,
        {
          fontSize: opts.size ?? 24,
          color: opts.color ?? INK,
          fontFamily: opts.font ?? SANS_FONT,
        },
        opts.width ?? 640,
      ),
  );
  el.setOffset(x, y);
  el.updateBounds();
  return el;
}

function addStroke(
  canvas: DrawableCanvas,
  pts: Pt[],
  color: string,
  size: number,
  // Constant-width nib instead of perfect-freehand's simulated pressure. The
  // simulated taper pinches inward at sharp corners (e.g. a check's vertex), so
  // opt into a uniform width there. Flat 0.5 pressure + real (non-simulated)
  // pressure yields an even stroke with rounded caps.
  constantWidth = false,
): StrokeElement {
  const flat: number[] = [];
  for (const [x, y] of pts) {
    flat.push(x, y, 0.5);
  }
  const el = canvas.addElement(
    (uuid) => new StrokeElement(uuid, flat, constantWidth, { color, size }),
  );
  el.updateBounds();
  return el;
}

function addShape(
  canvas: DrawableCanvas,
  shapeType: 'rect' | 'ellipse' | 'line' | 'triangle',
  x: number,
  y: number,
  geom: number[],
  color: string,
  size: number,
): ShapeElement {
  const el = canvas.addElement(
    (uuid) => new ShapeElement(uuid, shapeType, geom, { color, size }),
  );
  el.setOffset(x, y);
  el.updateBounds();
  return el;
}

/** Sampled polyline with perpendicular sine wobble, for a hand-drawn feel. */
function wobblyLine(a: Pt, b: Pt, wobble = 3, phase = 0): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const steps = Math.max(6, Math.round(len / 12));
  const nx = -dy / (len || 1);
  const ny = dx / (len || 1);
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const j = Math.sin(t * 7.3 + phase) * wobble * Math.sin(t * Math.PI);
    pts.push([a[0] + dx * t + nx * j, a[1] + dy * t + ny * j]);
  }
  return pts;
}

/** Slightly overshooting hand-drawn ellipse outline. */
function sketchEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phase = 0,
  rough = 0.03,
): Pt[] {
  const pts: Pt[] = [];
  const start = -0.4;
  const end = Math.PI * 2 + 0.35;
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    const j = 1 + Math.sin(t * 3.1 + phase) * rough;
    pts.push([cx + Math.cos(t) * rx * j, cy + Math.sin(t) * ry * j]);
  }
  return pts;
}

/** Hand-drawn rectangle outline with slightly overshooting corners. */
function sketchRect(
  x: number,
  y: number,
  w: number,
  h: number,
  wobble = 4,
): Pt[] {
  return [
    ...wobblyLine([x - 4, y], [x + w, y], wobble, 0.3),
    ...wobblyLine([x + w, y - 4], [x + w, y + h], wobble, 1.7),
    ...wobblyLine([x + w + 4, y + h], [x, y + h], wobble, 0.9),
    ...wobblyLine([x, y + h + 4], [x, y - 8], wobble, 2.4),
  ];
}

function drawUnderline(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  w: number,
  color = ORANGE,
  size = 7,
): void {
  addStroke(canvas, wobblyLine([x, y], [x + w, y - 4], 4, 1.2), color, size);
}

function drawArrow(
  canvas: DrawableCanvas,
  from: Pt,
  to: Pt,
  color = MUTED,
  size = 5,
): void {
  addStroke(canvas, wobblyLine(from, to, 5, 0.6), color, size);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = size * 4.5;
  const spread = 0.5;
  const left: Pt = [
    to[0] - ux * head - uy * head * spread,
    to[1] - uy * head + ux * head * spread,
  ];
  const right: Pt = [
    to[0] - ux * head + uy * head * spread,
    to[1] - uy * head - ux * head * spread,
  ];
  // Two straight barbs drawn from the tip outward as separate constant-width
  // strokes. Splitting them avoids a sharp single-stroke cusp at the tip (which
  // pinches under simulated pressure), and constant width keeps them even. The
  // barbs run a touch lighter than the shaft so the head does not read heavy.
  const barb = size * 0.8;
  addStroke(canvas, [to, left], color, barb, true);
  addStroke(canvas, [to, right], color, barb, true);
}

function drawCheck(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  scale = 1,
): void {
  // A real handwritten check: the actual pen path (60 samples) traced on the
  // canvas, normalized into this (x, y)-anchored frame. Because it is a genuine
  // traced curve rather than a synthetic V, the vertex rounds naturally and
  // perfect-freehand's simulated pressure never pinches into a fold.
  addStroke(
    canvas,
    [
      [x, y + 14.42 * scale],
      [x + 0.32 * scale, y + 14.74 * scale],
      [x + 0.96 * scale, y + 15.38 * scale],
      [x + 1.28 * scale, y + 15.7 * scale],
      [x + 1.92 * scale, y + 16.34 * scale],
      [x + 2.25 * scale, y + 16.66 * scale],
      [x + 2.89 * scale, y + 17.3 * scale],
      [x + 3.21 * scale, y + 18.26 * scale],
      [x + 3.85 * scale, y + 18.58 * scale],
      [x + 4.17 * scale, y + 19.23 * scale],
      [x + 5.13 * scale, y + 20.19 * scale],
      [x + 5.77 * scale, y + 20.51 * scale],
      [x + 6.09 * scale, y + 21.15 * scale],
      [x + 6.74 * scale, y + 21.47 * scale],
      [x + 7.7 * scale, y + 22.11 * scale],
      [x + 8.02 * scale, y + 22.43 * scale],
      [x + 8.66 * scale, y + 23.08 * scale],
      [x + 8.98 * scale, y + 23.4 * scale],
      [x + 9.62 * scale, y + 23.4 * scale],
      [x + 9.94 * scale, y + 24.04 * scale],
      [x + 10.58 * scale, y + 24.36 * scale],
      [x + 10.91 * scale, y + 24.36 * scale],
      [x + 10.91 * scale, y + 25 * scale],
      [x + 11.55 * scale, y + 25 * scale],
      [x + 11.87 * scale, y + 25 * scale],
      [x + 12.51 * scale, y + 25 * scale],
      [x + 12.51 * scale, y + 24.68 * scale],
      [x + 12.51 * scale, y + 24.04 * scale],
      [x + 12.83 * scale, y + 24.04 * scale],
      [x + 12.83 * scale, y + 23.72 * scale],
      [x + 13.79 * scale, y + 21.79 * scale],
      [x + 13.79 * scale, y + 20.83 * scale],
      [x + 14.43 * scale, y + 20.19 * scale],
      [x + 14.75 * scale, y + 18.26 * scale],
      [x + 15.4 * scale, y + 17.94 * scale],
      [x + 15.72 * scale, y + 16.98 * scale],
      [x + 15.72 * scale, y + 16.34 * scale],
      [x + 16.68 * scale, y + 14.42 * scale],
      [x + 17.32 * scale, y + 13.45 * scale],
      [x + 17.64 * scale, y + 13.13 * scale],
      [x + 18.28 * scale, y + 12.17 * scale],
      [x + 18.28 * scale, y + 11.53 * scale],
      [x + 19.25 * scale, y + 10.25 * scale],
      [x + 19.57 * scale, y + 9.28 * scale],
      [x + 20.21 * scale, y + 8.64 * scale],
      [x + 20.53 * scale, y + 7.68 * scale],
      [x + 21.49 * scale, y + 6.4 * scale],
      [x + 25.34 * scale, y + 0.62 * scale],
      [x + 26.94 * scale, y - 0.98 * scale],
      [x + 27.91 * scale, y - 1.94 * scale],
      [x + 28.23 * scale, y - 2.91 * scale],
      [x + 29.19 * scale, y - 3.23 * scale],
      [x + 29.83 * scale, y - 3.87 * scale],
      [x + 30.79 * scale, y - 5.15 * scale],
      [x + 31.11 * scale, y - 5.79 * scale],
      [x + 31.75 * scale, y - 6.11 * scale],
      [x + 32.08 * scale, y - 6.75 * scale],
      [x + 32.72 * scale, y - 7.08 * scale],
      [x + 34 * scale, y - 8.68 * scale],
      [x + 34.64 * scale, y - 9 * scale],
    ],
    GREEN,
    5 * scale,
  );
}

function hand(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  content: string,
  color = BLUE,
  size = 34,
  width = 420,
): TextElement {
  return addText(canvas, x, y, content, {
    size,
    color,
    width,
    font: HAND_FONT,
  });
}

function title(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  content: string,
  size = 62,
  width = 900,
): TextElement {
  return addText(canvas, x, y, content, { size, width, font: DISPLAY_FONT });
}

async function addPage(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  title: string,
  markdown: string,
): Promise<PageFrameElement> {
  const pf = canvas.addElement(
    (uuid) => new PageFrameElement(uuid, title, 'continuous'),
  );
  pf.setOffset(x, y);
  pf.updateBounds();
  const frag = pf.yXmlFragment;
  if (frag) {
    await writeMarkdownToPageFrameFragment(markdown, frag);
  }
  pf.updateBounds();
  return pf;
}

async function addPdf(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  url: string,
  width: number,
): Promise<PdfElement> {
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pageSizes = await getPdfPageSizes(bytes);
  const pdf = canvas.addElement((uuid) => new PdfElement(uuid));
  pdf.setInitialPdfData(bytes, url.replace(/^\//, ''), pageSizes);
  const scale = width / pdf.totalWidth;
  pdf.setScale(scale, scale);
  pdf.setOffset(x, y);
  pdf.updateBounds();
  return pdf;
}

async function addImage(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  url: string,
  width: number,
): Promise<ImageElement> {
  const res = await fetch(url);
  const data = await res.arrayBuffer();
  const img = canvas.addElement((uuid) => new ImageElement(uuid));
  await img.setImageData(data);
  const scale = width / img.naturalWidth;
  img.setScale(scale, scale);
  img.setOffset(x, y);
  img.updateBounds();
  return img;
}

async function buildHero(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  const underline = copy.decorations.heroUnderline;
  title(canvas, x, y + 30, copy.hero.headline, 88, 1120);
  drawUnderline(
    canvas,
    x + underline.dx,
    y + underline.dy,
    underline.width,
    ORANGE,
    8,
  );
  addText(canvas, x, y + 350, copy.hero.subheadline, {
    size: 27,
    color: MUTED,
    width: 900,
  });
  // The CTA buttons (DOM overlay) sit between the subheadline and trust line.
  addText(canvas, x, y + 690, copy.hero.trustLine, {
    size: 19,
    color: MUTED,
    width: 900,
  });

  // Right-hand screenshot of the app's library view, centered vertically.
  const imgW = 880;
  const imgH = imgW * (2120 / 3248);
  await addImage(
    canvas,
    r.x + 1030,
    r.y + (r.height - imgH) / 2,
    '/library.png',
    imgW,
  );
}

/**
 * The real PDF on the ink scene: a page of Einstein's 1905 energy-content
 * paper (public domain, `public/einstein-1905.pdf`), rendered by the engine's
 * own PdfElement rather than faked in DOM. `dx`/`dy` place its top-left corner
 * within the scene; the chrome header sits just above `dy`.
 */
const INK_PDF = { dx: 1270, dy: 130, width: 760 } as const;

async function buildInk(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): Promise<void> {
  // Pull the left column in from the scene edge so it and the PDF sit closer to
  // the middle rather than hugging opposite sides.
  const x = r.x + SCENE_PAD + 130;
  const y = r.y + SCENE_PAD;
  // Left half: the PDF story, with the shape-recognition demo as a playful
  // aside underneath.
  title(canvas, x, y + 170, copy.ink.pdfHeading, 72, 1000);
  addText(canvas, x, y + 430, copy.ink.pdfBody, {
    size: 26,
    color: MUTED,
    width: 840,
  });

  // Shape recognition, rough sketch -> clean shape.
  const sx = x + 60;
  addStroke(canvas, sketchRect(sx, y + 680, 240, 150, 6), INK, 6);
  drawArrow(canvas, [sx + 280, y + 755], [sx + 400, y + 755], MUTED, 5);
  addShape(canvas, 'rect', sx + 430, y + 680, [0, 0, 260, 150], INK, 6);
  hand(canvas, sx, y + 880, copy.ink.annotation, BLUE, 36, 440);
  hand(canvas, sx + 460, y + 880, copy.ink.recognized, GREEN, 36, 220);
  drawCheck(canvas, sx + 630, y + 890, 1.2);

  // Right half: the real PDF. The annotation offsets below are measured from
  // the page's own text, which sits on a ~595x842pt A4 page scaled to
  // INK_PDF.width, so 1pt is INK_PDF.width / 594.96 ~= 1.277 world units. The
  // circle rings the mass-energy result (Δm = L/c²) low on the page; the
  // highlight rides the "strikingly simple relation" phrase above it, the
  // underline sits under "its mass diminishes by L/c²" just below it, and the
  // margin note points back at the circled equation.
  const px = r.x + INK_PDF.dx;
  const py = r.y + INK_PDF.dy;
  await addPdf(canvas, px, py, '/einstein-1905.pdf', INK_PDF.width);

  addStroke(canvas, sketchEllipse(px + 478, py + 762, 56, 26, 2.2), PINK, 6);
  addStroke(
    canvas,
    wobblyLine([px + 200, py + 576], [px + 340, py + 572], 3, 0.9),
    HIGHLIGHT,
    19,
  );
  drawUnderline(canvas, px + 427, py + 811, 161, BLUE, 4);
  hand(canvas, px + 548, py + 702, copy.ink.pdfAnnotation, BLUE, 30, 163);
  drawArrow(canvas, [px + 560, py + 734], [px + 526, py + 749], BLUE, 4);
}

async function buildPages(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  // Left column is centered against the page frame to its right, which runs
  // from r.y + 175 to roughly r.y + 1105 (continuous layout, height measured
  // from the markdown below). The scene rect carries more padding above that
  // content than below it, which biases the whole scene down once the camera
  // centers the rect, clearing the fixed top bar.
  title(canvas, x, y + 230, copy.pages.heading, 62, 800);
  addText(canvas, x, y + 480, copy.pages.body, {
    size: 26,
    color: MUTED,
    width: 720,
  });
  hand(canvas, x + 60, y + 810, copy.pages.annotation, BLUE, 36, 420);
  drawArrow(canvas, [x + 500, y + 850], [x + 880, y + 790], BLUE, 5);

  await addPage(
    canvas,
    r.x + 1030,
    r.y + 175,
    copy.pages.pageTitle,
    copy.pages.pageMarkdown,
  );
}

function buildAudioSearch(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.audioSearch.heading, 62, 980);
  addText(canvas, x, y + 250, copy.audioSearch.audioBody, {
    size: 24,
    color: MUTED,
    width: 720,
  });
  addText(canvas, x + 880, y + 250, copy.audioSearch.searchBody, {
    size: 24,
    color: MUTED,
    width: 760,
  });
  // Mock app cards for both features live in the DOM underlay below these
  // captions (see scene-overlays.tsx).
}

async function buildLinked(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y + 185, copy.linked.heading, 62, 760);
  addText(canvas, x, y + 305, copy.linked.body, {
    size: 25,
    color: MUTED,
    width: 740,
  });

  // Right-hand screenshot of the app's graph view, centered vertically.
  const imgW = 800;
  const imgH = imgW * (2120 / 3248);
  await addImage(
    canvas,
    r.x + 860,
    r.y + (r.height - imgH) / 2,
    '/graph.png',
    imgW,
  );
}

function buildLocalFirst(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): void {
  // Pull the left column in from the scene edge so it sits closer to the
  // checklist instead of hugging the far side. The checklist stays put (it is
  // anchored off r.x below), so this closes the gutter from the left and evens
  // out the scene's outer margins at the same time.
  const x = r.x + SCENE_PAD + 100;
  const y = r.y + SCENE_PAD;

  // Left column: the thesis. A two-line headline with the highlighter riding
  // "your machine.", and a short lede on a tight measure. The whole block is
  // pushed down so its center lines up with the checklist across the gutter:
  // the headline and lede span roughly 370 units against the checklist's ~540,
  // so the offsets below sit the pair mid-height in the scene rather than
  // hanging the left column from the top edge.
  const highlight = copy.decorations.localFirstHighlight;
  title(canvas, x, y + 160, copy.localFirst.heading, 68, 700);
  addStroke(
    canvas,
    wobblyLine(
      [x + highlight.dx, y + highlight.dy],
      [x + highlight.dx + highlight.width, y + highlight.dy - 6],
      4,
      0.8,
    ),
    HIGHLIGHT,
    50,
  );
  addText(canvas, x, y + 420, copy.localFirst.lede, {
    size: 26,
    color: MUTED,
    width: 620,
  });

  // Right column: the five proof points as a checklist. Fixed row rhythm; the
  // closing bullet stays inked darker as the emphasis.
  const bullets = copy.localFirst.bullets;
  const px = r.x + 870;
  const py = y + 10;
  bullets.forEach((bullet, i) => {
    const by = py + 62 + i * 118;
    drawCheck(canvas, px + 50, by + 4, 0.9);
    addText(canvas, px + 116, by, bullet, {
      size: 23,
      color: i === bullets.length - 1 ? INK : MUTED,
      width: 660,
    });
  });
}

/**
 * Source-box geometry for the import scene, shared with the brand icons that
 * `scene-overlays.tsx` renders as DOM inside these boxes. Both sides must read
 * the same numbers or the icons drift out of their frames.
 */
export const IMPORT_BOXES = {
  /** Left edge of the box column, from the scene's own left edge. */
  dx: 950,
  width: 660,
  /**
   * Sized so the label and its two-line `detail` fill the box. That is what
   * puts the centred mark level with the text: slack here drops the icon below
   * the label it belongs to, which is how it looked when the box ran taller
   * than its content.
   */
  height: 140,
  gap: 26,
  /** Brand mark: inset from the box's left edge, centred on its height. */
  icon: { dx: 30, size: 40 },
} as const;

/** Top edge of the first source box, centred in the scene. */
export function importBoxTop(r: WorldRect, count: number): number {
  const stack = count * IMPORT_BOXES.height + (count - 1) * IMPORT_BOXES.gap;
  return r.y + SCENE_PAD + (r.height - SCENE_PAD * 2 - stack) / 2;
}

function buildImport(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  // Offsets sit the column's optical centre on the box stack's, which
  // `importBoxTop` centres in the scene. `body` is one line in every locale,
  // so the rhythm below does not shift as the copy is translated.
  title(canvas, x, y + 180, copy.importing.heading, 62, 660);
  addText(canvas, x, y + 390, copy.importing.body, {
    size: 26,
    color: MUTED,
    width: 660,
  });
  hand(canvas, x + 40, y + 490, copy.importing.annotation, BLUE, 36, 480);

  // Right column: the apps you are leaving, one per row. The brand marks are
  // DOM (see world-layer.tsx); only the frames and text are canvas elements.
  const sources = copy.importing.sources;
  const { width: boxW, height: boxH, gap, icon } = IMPORT_BOXES;
  const sx = r.x + IMPORT_BOXES.dx;
  const top = importBoxTop(r, sources.length);
  // Text clears the mark; the box keeps the same padding on the far side.
  const textX = sx + icon.dx + icon.size + 22;
  const textW = boxW - (textX - sx) - 34;

  sources.forEach((source, i) => {
    const by = top + i * (boxH + gap);
    addShape(canvas, 'rect', sx, by, [0, 0, boxW, boxH], MUTED, 3);
    addText(canvas, textX, by + 22, source.label, {
      size: 27,
      width: textW,
      font: DISPLAY_FONT,
    });
    addText(canvas, textX, by + 64, source.detail, {
      size: 19,
      color: MUTED,
      width: textW,
    });
  });
}

/** Anchor for the sync scene's DOM cursors (see scene-overlays.tsx). */
export const COLLAB_CURSORS = {
  you: { dx: 1280, dy: 230 },
  peer: { dx: 1670, dy: 240 },
} as const;

function buildSync(canvas: DrawableCanvas, r: WorldRect, copy: SiteCopy): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  // Dropped below the scene's top pad so the heading block sits level with the
  // cursor graphic on the right rather than riding above it.
  const textTop = y + 140;
  const underline = copy.decorations.syncUnderline;
  title(canvas, x, textTop, copy.sync.heading, 62, 800);
  addText(canvas, x, textTop + 200, copy.sync.kicker, {
    size: 26,
    width: 780,
  });
  drawUnderline(
    canvas,
    x + underline.dx,
    textTop + underline.dy,
    underline.width,
    ORANGE,
    6,
  );

  // Two live cursors (DOM, Figma-style) converging on a shared scrap of the
  // canvas; light ink trails mark where each one came from.
  const cx = r.x + 1150;
  const cy = r.y + 160;
  hand(canvas, cx + 200, cy + 240, copy.sync.sharedNote, INK, 40, 260);
  addStroke(canvas, sketchEllipse(cx + 320, cy + 290, 260, 170, 1.1), MUTED, 4);
  addStroke(
    canvas,
    wobblyLine(
      [cx - 40, cy - 60],
      [r.x + COLLAB_CURSORS.you.dx, r.y + COLLAB_CURSORS.you.dy],
      12,
      0.5,
    ),
    BLUE,
    5,
  );
  addStroke(
    canvas,
    wobblyLine(
      [cx + 700, cy - 40],
      [r.x + COLLAB_CURSORS.peer.dx, r.y + COLLAB_CURSORS.peer.dy],
      10,
      1.9,
    ),
    PINK,
    5,
  );

  copy.sync.tiers.forEach((tier, i) => {
    const tx = x + i * 610;
    const ty = y + 620;
    addShape(canvas, 'rect', tx, ty, [0, 0, 540, 350], MUTED, 3);
    hand(
      canvas,
      tx + 40,
      ty + 26,
      tier.badge,
      tier.shipped ? GREEN : ORANGE,
      34,
      200,
    );
    addText(canvas, tx + 40, ty + 100, tier.title, {
      size: 32,
      width: 460,
      font: DISPLAY_FONT,
    });
    addText(canvas, tx + 40, ty + 175, tier.body, {
      size: 22,
      color: MUTED,
      width: 460,
    });
  });
}

async function buildDownload(
  canvas: DrawableCanvas,
  r: WorldRect,
  copy: SiteCopy,
): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y + 40, copy.download.heading, 72, 900);
  addText(canvas, x, y + 160, copy.download.body, {
    size: 25,
    color: MUTED,
    width: 800,
  });
  // Download buttons + mobile note + footer links are DOM overlays; the canvas
  // leaves the band from y+280 to y+800 for them. The arrow lands just off the
  // primary button's right edge, which is why that button is laid out at a
  // fixed world width rather than sized by its text (see scene-overlays.tsx).
  hand(canvas, x + 680, y + 285, copy.download.autoUpdates, GREEN, 36, 300);
  drawArrow(canvas, [x + 665, y + 340], [x + 545, y + 345], GREEN, 4);

  await addPage(
    canvas,
    r.x + 1230,
    r.y + 70,
    copy.download.faqTitle,
    copy.download.faqMarkdown,
  );

  // Sits just above the footer links, which the overlay anchors at y+1080.
  title(canvas, x, y + 1010, copy.footer.tagline, 32, 700);
}

/**
 * Build the full landing document out of real engine elements. Runs once on an
 * empty in-memory Y.Doc; the caller clears undo history afterwards so a
 * visitor's Ctrl+Z can't erase the site.
 */
export async function populateScenes(
  canvas: DrawableCanvas,
  copy: SiteCopy,
): Promise<void> {
  ensureDisplayFont(HAND_FONT);
  const rect = (id: SceneId) => sceneById(id).rect;
  buildAudioSearch(canvas, rect('audio-search'), copy);
  buildLocalFirst(canvas, rect('local-first'), copy);
  buildSync(canvas, rect('sync'), copy);
  buildImport(canvas, rect('import'), copy);
  await buildInk(canvas, rect('ink'), copy);
  await buildHero(canvas, rect('hero'), copy);
  await buildLinked(canvas, rect('linked'), copy);
  await buildPages(canvas, rect('pages'), copy);
  await buildDownload(canvas, rect('download'), copy);
}
