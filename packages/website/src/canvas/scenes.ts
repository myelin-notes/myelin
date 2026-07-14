import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
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
  { id: 'problem', label: 'Why', w: 1750, h: 800 },
  { id: 'ink', label: 'Ink', w: 1850, h: 950 },
  { id: 'pages', label: 'Pages', w: 1900, h: 1350 },
  { id: 'pdf', label: 'PDFs', w: 1850, h: 1100 },
  { id: 'audio-search', label: 'Audio & search', w: 1900, h: 1000 },
  { id: 'collab', label: 'Live collab', w: 1850, h: 900 },
  { id: 'linked', label: 'Linked notes', w: 1750, h: 800 },
  { id: 'local-first', label: 'Local-first', w: 1750, h: 1100 },
  { id: 'sync', label: 'Sync', w: 1950, h: 750 },
  { id: 'lock-in', label: 'No lock-in', w: 1750, h: 900 },
  { id: 'supporter', label: 'Support', w: 1800, h: 1150 },
  { id: 'roadmap', label: 'Roadmap', w: 1950, h: 1100 },
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

/**
 * Hand-drawn five-point star, the hero's sample doodle. Edges are sampled
 * densely (via wobblyLine) so the renderer's smoothing keeps the points sharp.
 */
function sketchStar(cx: number, cy: number, radius: number): Pt[] {
  const verts: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? radius : radius * 0.42;
    verts.push([cx + Math.cos(angle) * rr, cy + Math.sin(angle) * rr]);
  }
  const pts: Pt[] = [];
  for (let i = 0; i < verts.length - 1; i++) {
    pts.push(...wobblyLine(verts[i], verts[i + 1], 1.5, i * 0.9));
  }
  return pts;
}

function buildHero(canvas: DrawableCanvas, r: WorldRect): void {
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

  // Right-hand doodle corner inviting visitors to draw: the note, an arrow
  // into open space, and one sample star doodle beside it.
  hand(canvas, r.x + 1430, r.y + 250, copy.hero.tryIt, BLUE, 36, 460);
  drawArrow(canvas, [r.x + 1490, r.y + 410], [r.x + 1560, r.y + 580], BLUE, 5);
  addStroke(canvas, sketchStar(r.x + 1380, r.y + 650, 85), ORANGE, 6);
}

function buildProblem(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.problem.heading, 62, 820);
  addText(canvas, x, y + 240, copy.problem.body, {
    size: 26,
    color: MUTED,
    width: 760,
  });

  // Three app boxes funneling into one circled canvas. Each arrow lands on
  // the ellipse's left rim at its own height so the heads never overlap.
  const bx = r.x + 1000;
  const ex = bx + 640;
  const ey = y + 260;
  const targets: Pt[] = [
    [ex - 128, ey - 62],
    [ex - 168, ey],
    [ex - 128, ey + 62],
  ];
  copy.problem.boxes.forEach((label, i) => {
    const by = y + i * 190;
    addShape(canvas, 'rect', bx, by, [0, 0, 330, 110], MUTED, 3);
    addText(canvas, bx + 34, by + 38, label, {
      size: 24,
      color: INK,
      width: 280,
    });
    drawArrow(canvas, [bx + 366, by + 55], targets[i], MUTED, 4);
  });
  addStroke(canvas, sketchEllipse(ex, ey, 150, 92, 1.7), ORANGE, 7);
  hand(canvas, ex - 92, ey - 30, copy.problem.convergence, INK, 44, 200);
}

function buildInk(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.ink.heading, 62, 860);
  addText(canvas, x, y + 250, copy.ink.body, {
    size: 26,
    color: MUTED,
    width: 780,
  });
  // A line worth highlighting, with a real highlighter swipe over it.
  addText(canvas, x, y + 520, 'Highlight anything, anywhere.', {
    size: 30,
    width: 520,
  });
  addStroke(
    canvas,
    wobblyLine([x - 10, y + 540], [x + 450, y + 536], 4, 0.4),
    HIGHLIGHT,
    44,
  );

  // Colorful pen squiggles.
  addStroke(
    canvas,
    wobblyLine([x, y + 680], [x + 300, y + 720], 26, 0.2),
    BLUE,
    7,
  );
  addStroke(
    canvas,
    wobblyLine([x + 90, y + 750], [x + 420, y + 700], 20, 2.6),
    PINK,
    7,
  );

  // Shape recognition, shown twice: rough sketch -> arrow -> clean shape.
  const sx = r.x + 1000;
  addStroke(
    canvas,
    sketchEllipse(sx + 130, y + 160, 130, 92, 0.4, 0.09),
    INK,
    6,
  );
  drawArrow(canvas, [sx + 300, y + 160], [sx + 420, y + 160], MUTED, 5);
  addShape(canvas, 'ellipse', sx + 450, y + 75, [0, 0, 270, 170], INK, 6);
  hand(canvas, sx + 20, y + 290, copy.ink.annotation, BLUE, 34, 320);

  addStroke(canvas, sketchRect(sx + 20, y + 450, 250, 150, 6), INK, 6);
  drawArrow(canvas, [sx + 310, y + 525], [sx + 420, y + 525], MUTED, 5);
  addShape(canvas, 'rect', sx + 450, y + 450, [0, 0, 270, 150], INK, 6);
  hand(canvas, sx + 470, y + 640, copy.ink.recognized, GREEN, 34, 220);
  drawCheck(canvas, sx + 640, y + 650, 1.2);
}

async function buildPages(canvas: DrawableCanvas, r: WorldRect): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y + 60, copy.pages.heading, 62, 800);
  addText(canvas, x, y + 310, copy.pages.body, {
    size: 26,
    color: MUTED,
    width: 720,
  });
  hand(canvas, x + 60, y + 640, copy.pages.annotation, BLUE, 36, 420);
  drawArrow(canvas, [x + 500, y + 680], [x + 880, y + 620], BLUE, 5);

  await addPage(
    canvas,
    r.x + 1030,
    r.y + 60,
    copy.pages.pageTitle,
    copy.pages.pageMarkdown,
  );
}

function buildPdf(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y + 80, copy.pdf.heading, 62, 760);
  addText(canvas, x, y + 260, copy.pdf.body, {
    size: 26,
    color: MUTED,
    width: 700,
  });

  // Ink annotations over the mock PDF page (DOM underlay renders the page at
  // these same coordinates, see scene-overlays.tsx). Offsets track the page's
  // skeleton bars: the circle rings the equation, the highlight and underline
  // ride their own sentences.
  const px = r.x + 930;
  const py = r.y + 120;
  addStroke(canvas, sketchEllipse(px + 390, py + 314, 200, 62, 2.2), PINK, 6);
  addStroke(
    canvas,
    wobblyLine([px + 66, py + 482], [px + 560, py + 478], 4, 0.9),
    HIGHLIGHT,
    40,
  );
  drawUnderline(canvas, px + 64, py + 634, 380, BLUE, 5);
  hand(canvas, px + 470, py + 690, copy.pdf.annotation, BLUE, 34, 320);
  drawArrow(canvas, [px + 520, py + 672], [px + 430, py + 508], BLUE, 4);
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

/** Anchor for the collab scene's DOM cursors (see scene-overlays.tsx). */
export const COLLAB_CURSORS = {
  you: { dx: 1270, dy: 380 },
  peer: { dx: 1600, dy: 440 },
} as const;

function buildCollab(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.collab.heading, 62, 860);
  addText(canvas, x, y + 250, copy.collab.body, {
    size: 25,
    color: MUTED,
    width: 780,
  });
  addText(canvas, x, y + 520, copy.collab.kicker, {
    size: 27,
    width: 760,
  });
  drawUnderline(canvas, x, y + 640, 480, ORANGE, 6);

  // Two live cursors (DOM, Figma-style) converging on a shared scrap of the
  // canvas; light ink trails mark where each one came from.
  const cx = r.x + 1120;
  const cy = r.y + 260;
  hand(canvas, cx + 200, cy + 215, copy.collab.sharedNote, INK, 40, 260);
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
}

function buildLinked(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.linked.heading, 62, 760);
  addText(canvas, x, y + 160, copy.linked.body, {
    size: 25,
    color: MUTED,
    width: 740,
  });

  // Three circled note links; each ellipse hugs its own label.
  const nx = r.x + 1000;
  const centers: Pt[] = [
    [nx + 160, y + 90],
    [nx + 560, y + 290],
    [nx + 220, y + 500],
  ];
  const radii: number[] = [];
  copy.linked.notes.forEach((note, i) => {
    const [ncx, ncy] = centers[i];
    const textWidth = note.length * 12.2;
    const rx = textWidth / 2 + 42;
    radii.push(rx);
    addText(canvas, ncx - textWidth / 2, ncy - 18, note, {
      size: 26,
      color: BLUE,
      width: textWidth + 30,
    });
    addStroke(canvas, sketchEllipse(ncx, ncy, rx, 48, i * 1.3), MUTED, 3);
  });
  // Rim-to-rim arrows between consecutive notes.
  for (let i = 0; i < 2; i++) {
    const [ax, ay] = centers[i];
    const [tx, ty] = centers[i + 1];
    const dx = tx - ax;
    const dy = ty - ay;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    drawArrow(
      canvas,
      [ax + ux * (radii[i] + 14), ay + uy * 62],
      [tx - ux * (radii[i + 1] + 18), ty - uy * 72],
      MUTED,
      4,
    );
  }
  hand(canvas, nx + 480, y + 480, copy.linked.annotation, BLUE, 32, 300);
}

function buildLocalFirst(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.localFirst.heading, 62, 1000);
  drawUnderline(canvas, x, y + 110, 700, ORANGE, 8);

  // "the cloud", circled and crossed out, next to the heading.
  const ccx = x + 1230;
  const ccy = y + 40;
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
    const by = y + 200 + i * 118;
    drawCheck(canvas, x + 6, by + 8, 0.9);
    addText(canvas, x + 64, by, bullet, {
      size: 24,
      color: i === 4 ? INK : MUTED,
      width: 1280,
    });
  });
  // The GitHub source button (DOM overlay) sits below the last bullet.
}

function buildSync(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.sync.heading, 62, 700);
  copy.sync.tiers.forEach((tier, i) => {
    const tx = x + i * 610;
    const ty = y + 180;
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

function buildLockIn(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.lockIn.heading, 62, 800);
  addText(canvas, x, y + 250, copy.lockIn.importBody, {
    size: 25,
    color: MUTED,
    width: 740,
  });
  addText(canvas, x, y + 500, copy.lockIn.mcpBody, {
    size: 25,
    color: MUTED,
    width: 740,
  });

  // Right column: two handwritten in/out lines, then the circled MCP note.
  const dx = r.x + 1030;
  hand(canvas, dx, y + 100, copy.lockIn.importLabel, GREEN, 38, 520);
  drawUnderline(canvas, dx + 4, y + 165, 400, GREEN, 4);
  hand(canvas, dx, y + 240, copy.lockIn.exportLabel, ORANGE, 38, 520);
  drawUnderline(canvas, dx + 4, y + 305, 380, ORANGE, 4);
  addStroke(canvas, sketchEllipse(dx + 300, y + 560, 230, 105, 2.6), BLUE, 5);
  hand(canvas, dx + 165, y + 505, 'MCP: your\nAI, your rules', BLUE, 38, 300);
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

function buildRoadmap(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  title(canvas, x, y, copy.roadmap.heading, 62, 700);
  addText(canvas, x, y + 120, copy.roadmap.body, {
    size: 24,
    color: MUTED,
    width: 800,
  });
  copy.roadmap.columns.forEach((column, i) => {
    const cx = x + i * 620;
    const cy = y + 280;
    hand(canvas, cx, cy, column.title, i === 2 ? ORANGE : INK, 40, 480);
    addText(canvas, cx, cy + 90, column.items, {
      size: 23,
      color: MUTED,
      width: 520,
    });
    if (i > 0) {
      addStroke(
        canvas,
        wobblyLine([cx - 60, cy - 10], [cx - 66, cy + 400], 5, i * 1.1),
        'rgba(89, 100, 107, 0.4)',
        3,
      );
    }
  });
  // Roadmap link button (DOM overlay) sits under the columns.
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
  buildHero(canvas, rect('hero'));
  buildProblem(canvas, rect('problem'));
  buildInk(canvas, rect('ink'));
  buildPdf(canvas, rect('pdf'));
  buildAudioSearch(canvas, rect('audio-search'));
  buildCollab(canvas, rect('collab'));
  buildLinked(canvas, rect('linked'));
  buildLocalFirst(canvas, rect('local-first'));
  buildSync(canvas, rect('sync'));
  buildLockIn(canvas, rect('lock-in'));
  buildSupporter(canvas, rect('supporter'));
  buildRoadmap(canvas, rect('roadmap'));
  await buildPages(canvas, rect('pages'));
  await buildDownload(canvas, rect('download'));
}
