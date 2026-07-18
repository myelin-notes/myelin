import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { ImageElement } from '@myelin/editor/elements/image-element';
import { PageFrameElement } from '@myelin/editor/elements/page-frame-element';
import { ShapeElement } from '@myelin/editor/elements/shape-element';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import { TextElement } from '@myelin/editor/elements/text/element';
import { ensureDisplayFont } from '@myelin/editor/google-fonts';
import { writeMarkdownToPageFrameFragment } from '@myelin/editor/page-frame/markdown/import';
import { copy } from '@/content/site';

/** Plain world-space rect (DOMRect is constructed lazily, client-side only). */
export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneDef {
  id: string;
  label: string;
  rect: WorldRect;
}

/** Shared content inset used by both canvas builders and DOM overlays. */
export const SCENE_PAD = 90;

const SCENE_GAP = 700;
const Y_HIGH = 80;
const Y_LOW = 1050;

const SIZES: Array<{ id: string; label: string; w: number; h: number }> = [
  { id: 'hero', label: 'Myelin', w: 2000, h: 1000 },
  { id: 'ink', label: 'PDFs', w: 2250, h: 1180 },
  { id: 'pages', label: 'Pages', w: 1900, h: 1140 },
  { id: 'audio-search', label: 'Audio & search', w: 1900, h: 1000 },
  { id: 'linked', label: 'Linked notes', w: 1750, h: 800 },
  { id: 'local-first', label: 'Local-first', w: 2200, h: 1150 },
  { id: 'sync', label: 'Sync & collab', w: 1950, h: 1150 },
  { id: 'supporter', label: 'Support', w: 1800, h: 1150 },
  { id: 'download', label: 'Download', w: 2100, h: 1400 },
];

/** Scenes laid out on a left-to-right zigzag so camera moves feel spatial. */
export const SCENES: SceneDef[] = (() => {
  let x = 0;
  return SIZES.map((s, i) => {
    const def: SceneDef = {
      id: s.id,
      label: s.label,
      rect: { x, y: i % 2 === 0 ? Y_HIGH : Y_LOW, width: s.w, height: s.h },
    };
    x += s.w + SCENE_GAP;
    return def;
  });
})();

export function sceneById(id: string): SceneDef {
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
): StrokeElement {
  const flat: number[] = [];
  for (const [x, y] of pts) {
    flat.push(x, y, 0.5);
  }
  const el = canvas.addElement(
    (uuid) => new StrokeElement(uuid, flat, false, { color, size }),
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
  const left: Pt = [
    to[0] - ux * head - uy * head * 0.55,
    to[1] - uy * head + ux * head * 0.55,
  ];
  const right: Pt = [
    to[0] - ux * head + uy * head * 0.55,
    to[1] - uy * head - ux * head * 0.55,
  ];
  addStroke(canvas, [left, to, right], color, size);
}

function drawCheck(
  canvas: DrawableCanvas,
  x: number,
  y: number,
  scale = 1,
): void {
  addStroke(
    canvas,
    [
      [x, y + 12 * scale],
      [x + 10 * scale, y + 24 * scale],
      [x + 30 * scale, y - 2 * scale],
    ],
    GREEN,
    6 * scale,
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

async function buildHero(canvas: DrawableCanvas, r: WorldRect): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y + 30, copy.hero.headline, 88, 1120);
  drawUnderline(canvas, x + 4, y + 290, 540, ORANGE, 8);
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

/** Where the PDF mock's top-left corner sits (DOM underlay, world-layer.tsx). */
export const INK_PDF_MOCK = { dx: 1380, dy: 160 } as const;

function buildInk(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  // Left half: the PDF story, with the shape-recognition demo as a playful
  // aside underneath.
  title(canvas, x, y + 150, copy.ink.pdfHeading, 72, 1000);
  drawUnderline(canvas, x + 4, y + 365, 520, ORANGE, 8);
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

  // Right half: the mock PDF page (DOM underlay at INK_PDF_MOCK, see
  // scene-overlays.tsx), centered vertically. The annotation offsets below
  // track the mock's skeleton bars, so the circle rings the equation and the
  // highlight and underline ride their own sentences.
  const px = r.x + INK_PDF_MOCK.dx;
  const py = r.y + INK_PDF_MOCK.dy;
  addStroke(canvas, sketchEllipse(px + 390, py + 314, 200, 62, 2.2), PINK, 6);
  addStroke(
    canvas,
    wobblyLine([px + 66, py + 482], [px + 560, py + 478], 4, 0.9),
    HIGHLIGHT,
    40,
  );
  drawUnderline(canvas, px + 64, py + 634, 380, BLUE, 5);
  hand(canvas, px + 470, py + 690, copy.ink.pdfAnnotation, BLUE, 34, 320);
  drawArrow(canvas, [px + 520, py + 672], [px + 430, py + 508], BLUE, 4);
}

async function buildPages(canvas: DrawableCanvas, r: WorldRect): Promise<void> {
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

function buildAudioSearch(canvas: DrawableCanvas, r: WorldRect): void {
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
): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.linked.heading, 62, 760);
  addText(canvas, x, y + 160, copy.linked.body, {
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

function buildLocalFirst(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.localFirst.heading, 62, 820);
  drawUnderline(canvas, x, y + 110, 700, ORANGE, 8);

  // "the cloud", circled and crossed out, beside the heading.
  const ccx = x + 990;
  const ccy = y + 60;
  hand(canvas, ccx - 62, ccy - 26, 'the cloud', MUTED, 36, 180);
  addStroke(canvas, sketchEllipse(ccx, ccy, 120, 52, 0.5), MUTED, 4);
  addStroke(
    canvas,
    wobblyLine([ccx - 110, ccy - 46], [ccx + 116, ccy + 42], 4, 0.7),
    PINK,
    6,
  );
  addStroke(
    canvas,
    wobblyLine([ccx + 110, ccy - 46], [ccx - 116, ccy + 42], 4, 1.8),
    PINK,
    6,
  );

  copy.localFirst.bullets.forEach((bullet, i) => {
    const by = y + 240 + i * 130;
    drawCheck(canvas, x + 6, by + 8, 0.9);
    addText(canvas, x + 64, by, bullet, {
      size: 24,
      color: i === 4 ? INK : MUTED,
      width: 1150,
    });
  });
  // The GitHub source button (DOM overlay) sits below the last bullet.

  // Right column: no lock-in. Data in, data out, and your own AI.
  const dx = r.x + 1400;
  title(canvas, dx, y, copy.localFirst.lockInHeading, 46, 620);
  addText(canvas, dx, y + 150, copy.localFirst.importBody, {
    size: 24,
    color: MUTED,
    width: 700,
  });
  hand(canvas, dx, y + 360, copy.localFirst.importLabel, GREEN, 38, 520);
  drawUnderline(canvas, dx + 4, y + 425, 400, GREEN, 4);
  hand(canvas, dx, y + 490, copy.localFirst.exportLabel, ORANGE, 38, 520);
  drawUnderline(canvas, dx + 4, y + 555, 380, ORANGE, 4);
  addText(canvas, dx, y + 610, copy.localFirst.mcpBody, {
    size: 24,
    color: MUTED,
    width: 700,
  });
  addStroke(canvas, sketchEllipse(dx + 300, y + 840, 230, 105, 2.6), BLUE, 5);
  hand(canvas, dx + 165, y + 785, 'MCP: your\nAI, your rules', BLUE, 38, 300);
}

/** Anchor for the sync scene's DOM cursors (see scene-overlays.tsx). */
export const COLLAB_CURSORS = {
  you: { dx: 1280, dy: 230 },
  peer: { dx: 1670, dy: 240 },
} as const;

function buildSync(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.sync.heading, 62, 800);
  addText(canvas, x, y + 200, copy.sync.kicker, {
    size: 26,
    width: 780,
  });
  drawUnderline(canvas, x, y + 310, 480, ORANGE, 6);

  // Two live cursors (DOM, Figma-style) converging on a shared scrap of the
  // canvas; light ink trails mark where each one came from.
  const cx = r.x + 1150;
  const cy = r.y + 160;
  hand(canvas, cx + 200, cy + 215, copy.sync.sharedNote, INK, 40, 260);
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
      tier.badge === 'Coming' ? ORANGE : GREEN,
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

function buildSupporter(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.supporter.heading, 56, 1100);
  addText(canvas, x, y + 240, copy.supporter.body, {
    size: 26,
    color: MUTED,
    width: 820,
  });
  copy.supporter.benefits.forEach((benefit, i) => {
    const by = y + 400 + i * 90;
    drawCheck(canvas, x + 6, by + 6, 0.9);
    addText(canvas, x + 64, by, benefit, { size: 25, width: 900 });
  });
  addText(canvas, x, y + 790, copy.supporter.reassurance, {
    size: 21,
    color: MUTED,
    width: 800,
  });
  // Sponsor buttons (DOM overlay) render to the right of the benefits list.
  addStroke(canvas, sketchEllipse(r.x + 1400, y + 510, 240, 140, 0.2), PINK, 6);
  hand(canvas, r.x + 1290, y + 450, 'keep it\nindependent', PINK, 44, 260);
}

async function buildDownload(
  canvas: DrawableCanvas,
  r: WorldRect,
): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.download.heading, 72, 900);
  addText(canvas, x, y + 160, copy.download.body, {
    size: 25,
    color: MUTED,
    width: 800,
  });
  // Download buttons + iPad badge + footer links are DOM overlays; the canvas
  // leaves the band from y+260 to y+700 for them.
  hand(canvas, x + 640, y + 290, 'auto-updates\nincluded', GREEN, 36, 300);
  drawArrow(canvas, [x + 620, y + 350], [x + 500, y + 330], GREEN, 4);

  await addPage(
    canvas,
    r.x + 1230,
    r.y + 70,
    copy.download.faqTitle,
    copy.download.faqMarkdown,
  );

  title(canvas, x, y + 900, copy.footer.tagline, 32, 700);
  addText(canvas, x, y + 970, copy.footer.privacyNote, {
    size: 19,
    color: MUTED,
    width: 800,
  });
}

/**
 * Build the full landing document out of real engine elements. Runs once on an
 * empty in-memory Y.Doc; the caller clears undo history afterwards so a
 * visitor's Ctrl+Z can't erase the site.
 */
export async function populateScenes(canvas: DrawableCanvas): Promise<void> {
  ensureDisplayFont(HAND_FONT);
  const rect = (id: string) => sceneById(id).rect;
  buildInk(canvas, rect('ink'));
  buildAudioSearch(canvas, rect('audio-search'));
  buildLocalFirst(canvas, rect('local-first'));
  buildSync(canvas, rect('sync'));
  buildSupporter(canvas, rect('supporter'));
  await buildHero(canvas, rect('hero'));
  await buildLinked(canvas, rect('linked'));
  await buildPages(canvas, rect('pages'));
  await buildDownload(canvas, rect('download'));
}
