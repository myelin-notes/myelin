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
  { id: 'local-first', label: 'Local-first', w: 1750, h: 1250 },
  { id: 'sync', label: 'Sync', w: 1950, h: 950 },
  { id: 'lock-in', label: 'No lock-in', w: 1750, h: 900 },
  { id: 'supporter', label: 'Support', w: 1800, h: 1150 },
  { id: 'roadmap', label: 'Roadmap', w: 1950, h: 1200 },
  { id: 'download', label: 'Download', w: 2100, h: 1500 },
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

const INK = '#1a1a1a';
const MUTED = '#59646b';
const BLUE = '#3b82f6';
const PINK = '#ec4899';
const ORANGE = '#f97316';
const GREEN = '#16a34a';
const HIGHLIGHT = 'rgba(250, 204, 21, 0.3)';
const HAND_FONT = 'Caveat';

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
          fontFamily: opts.font ?? 'sans-serif',
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
): Pt[] {
  const pts: Pt[] = [];
  const start = -0.4;
  const end = Math.PI * 2 + 0.35;
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    const j = 1 + Math.sin(t * 3.1 + phase) * 0.03;
    pts.push([cx + Math.cos(t) * rx * j, cy + Math.sin(t) * ry * j]);
  }
  return pts;
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
  const head = 26;
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

function buildHero(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y + 30, copy.hero.headline, { size: 88, width: 1120 });
  drawUnderline(canvas, x + 4, y + 290, 560, ORANGE, 8);
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

  // Right-hand doodle corner inviting visitors to draw.
  hand(canvas, r.x + 1430, r.y + 250, copy.hero.tryIt, BLUE, 36, 460);
  drawArrow(canvas, [r.x + 1500, r.y + 400], [r.x + 1420, r.y + 560], BLUE, 5);
  addStroke(
    canvas,
    sketchEllipse(r.x + 1620, r.y + 700, 190, 120, 0.8),
    PINK,
    6,
  );
  addStroke(
    canvas,
    wobblyLine([r.x + 1480, r.y + 720], [r.x + 1760, r.y + 680], 14, 2.1),
    ORANGE,
    7,
  );
}

function buildProblem(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.problem.heading, { size: 62, width: 820 });
  addText(canvas, x, y + 240, copy.problem.body, {
    size: 26,
    color: MUTED,
    width: 760,
  });

  // Three app boxes funneling into one circled canvas.
  const bx = r.x + 1000;
  copy.problem.boxes.forEach((label, i) => {
    const by = y + i * 190;
    addShape(canvas, 'rect', bx, by, [0, 0, 330, 110], MUTED, 4);
    addText(canvas, bx + 34, by + 36, label, {
      size: 24,
      color: INK,
      width: 280,
    });
    drawArrow(
      canvas,
      [bx + 360, by + 60],
      [bx + 520, y + 250 + (1 - i) * 12],
      MUTED,
      4,
    );
  });
  addStroke(canvas, sketchEllipse(bx + 630, y + 260, 150, 90, 1.7), ORANGE, 7);
  hand(canvas, bx + 545, y + 225, copy.problem.convergence, INK, 44, 260);
}

function buildInk(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.ink.heading, { size: 62, width: 860 });
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

  // Rough sketch -> recognized shapes.
  const sx = r.x + 1080;
  addStroke(canvas, sketchEllipse(sx + 140, y + 170, 150, 100, 0.4), INK, 6);
  hand(canvas, sx + 20, y + 320, copy.ink.annotation, BLUE, 34, 320);
  drawArrow(canvas, [sx + 330, y + 170], [sx + 470, y + 170], MUTED, 5);
  addShape(canvas, 'ellipse', sx + 500, y + 90, [0, 0, 280, 170], INK, 6);
  addShape(canvas, 'rect', sx + 220, y + 470, [0, 0, 300, 180], INK, 6);
  hand(canvas, sx + 560, y + 490, copy.ink.recognized, GREEN, 34, 260);
  drawCheck(canvas, sx + 560, y + 550, 1.4);
}

async function buildPages(canvas: DrawableCanvas, r: WorldRect): Promise<void> {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y + 60, copy.pages.heading, { size: 62, width: 800 });
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
  addText(canvas, x, y + 80, copy.pdf.heading, { size: 62, width: 760 });
  addText(canvas, x, y + 260, copy.pdf.body, {
    size: 26,
    color: MUTED,
    width: 700,
  });

  // Ink annotations over the screenshot placeholder (DOM underlay renders the
  // placeholder frame at these same coordinates, see scene-overlays.tsx).
  const px = r.x + 930;
  const py = r.y + 120;
  addStroke(canvas, sketchEllipse(px + 350, py + 300, 200, 70, 2.2), PINK, 6);
  addStroke(
    canvas,
    wobblyLine([px + 120, py + 480], [px + 560, py + 474], 4, 0.9),
    HIGHLIGHT,
    40,
  );
  drawUnderline(canvas, px + 130, py + 610, 330, BLUE, 5);
  hand(canvas, px + 480, py + 680, copy.pdf.annotation, BLUE, 34, 320);
  drawArrow(canvas, [px + 540, py + 660], [px + 430, py + 560], BLUE, 4);
}

function buildAudioSearch(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.audioSearch.heading, { size: 62, width: 980 });
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
  // Placeholder cards for both features live in the DOM underlay below these
  // captions; a waveform doodle ties the audio card to the copy.
  const wave: Pt[] = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    wave.push([
      x + t * 560,
      y + 480 + Math.sin(t * 26) * (14 + Math.sin(t * 4.4) * 10),
    ]);
  }
  addStroke(canvas, wave, BLUE, 4);
}

function buildCollab(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.collab.heading, { size: 62, width: 860 });
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

  // Two live cursors converging on a shared scrap of the canvas.
  const cx = r.x + 1120;
  const cy = r.y + 260;
  hand(canvas, cx + 210, cy + 210, copy.collab.sharedNote, INK, 40, 320);
  addStroke(canvas, sketchEllipse(cx + 320, cy + 290, 260, 170, 1.1), MUTED, 4);

  addStroke(
    canvas,
    wobblyLine([cx - 40, cy - 60], [cx + 150, cy + 120], 30, 0.5),
    BLUE,
    6,
  );
  addShape(
    canvas,
    'triangle',
    cx + 150,
    cy + 120,
    [0, 0, 22, 30, 9, 34],
    BLUE,
    5,
  );
  hand(canvas, cx + 185, cy + 120, copy.collab.cursorYou, BLUE, 30, 120);

  addStroke(
    canvas,
    wobblyLine([cx + 700, cy - 40], [cx + 480, cy + 180], 24, 1.9),
    PINK,
    6,
  );
  addShape(
    canvas,
    'triangle',
    cx + 480,
    cy + 180,
    [0, 0, 22, 30, 9, 34],
    PINK,
    5,
  );
  hand(canvas, cx + 515, cy + 180, copy.collab.cursorPeer, PINK, 30, 120);
}

function buildLinked(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.linked.heading, { size: 62, width: 760 });
  addText(canvas, x, y + 160, copy.linked.body, {
    size: 25,
    color: MUTED,
    width: 740,
  });

  const nx = r.x + 1000;
  const positions: Pt[] = [
    [nx, y + 60],
    [nx + 420, y + 260],
    [nx + 60, y + 480],
  ];
  copy.linked.notes.forEach((note, i) => {
    const [px, py] = positions[i];
    addText(canvas, px, py, note, { size: 26, color: BLUE, width: 340 });
    addStroke(
      canvas,
      sketchEllipse(px + 140, py + 20, 190, 60, i * 1.3),
      MUTED,
      3,
    );
  });
  drawArrow(
    canvas,
    [positions[0][0] + 300, positions[0][1] + 60],
    [positions[1][0] + 60, positions[1][1] - 30],
    MUTED,
    4,
  );
  drawArrow(
    canvas,
    [positions[1][0] + 40, positions[1][1] + 60],
    [positions[2][0] + 280, positions[2][1] - 10],
    MUTED,
    4,
  );
  hand(canvas, nx + 430, y + 470, copy.linked.annotation, BLUE, 32, 300);
}

function buildLocalFirst(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.localFirst.heading, { size: 62, width: 1000 });
  drawUnderline(canvas, x, y + 110, 700, ORANGE, 8);
  copy.localFirst.bullets.forEach((bullet, i) => {
    const by = y + 200 + i * 150;
    drawCheck(canvas, x + 6, by + 10);
    addText(canvas, x + 70, by, bullet, {
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
  addText(canvas, x, y, copy.sync.heading, { size: 62, width: 700 });
  copy.sync.tiers.forEach((tier, i) => {
    const tx = x + i * 610;
    const ty = y + 180;
    addShape(canvas, 'rect', tx, ty, [0, 0, 540, 560], MUTED, 3);
    hand(
      canvas,
      tx + 40,
      ty + 30,
      tier.badge,
      tier.badge === 'Coming' ? ORANGE : GREEN,
      34,
      200,
    );
    addText(canvas, tx + 40, ty + 110, tier.title, { size: 32, width: 460 });
    addText(canvas, tx + 40, ty + 190, tier.body, {
      size: 22,
      color: MUTED,
      width: 460,
    });
  });
}

function buildLockIn(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.lockIn.heading, { size: 62, width: 800 });
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

  const dx = r.x + 1050;
  drawArrow(canvas, [dx, y + 160], [dx + 240, y + 160], GREEN, 6);
  hand(canvas, dx + 40, y + 60, copy.lockIn.importLabel, GREEN, 34, 480);
  drawArrow(canvas, [dx + 240, y + 360], [dx, y + 360], ORANGE, 6);
  hand(canvas, dx + 40, y + 390, copy.lockIn.exportLabel, ORANGE, 34, 480);
  addStroke(canvas, sketchEllipse(dx + 320, y + 620, 220, 100, 2.6), BLUE, 5);
  hand(canvas, dx + 190, y + 580, 'MCP: your\nAI, your rules', BLUE, 36, 300);
}

function buildSupporter(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.supporter.heading, { size: 56, width: 1100 });
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
  addStroke(canvas, sketchEllipse(r.x + 1400, y + 500, 260, 160, 0.2), PINK, 6);
  hand(canvas, r.x + 1270, y + 430, 'keep it\nindependent', PINK, 44, 320);
}

function buildRoadmap(canvas: DrawableCanvas, r: WorldRect): void {
  const x = r.x + SCENE_PAD;
  const y = r.y + SCENE_PAD;
  addText(canvas, x, y, copy.roadmap.heading, { size: 62, width: 700 });
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
        wobblyLine([cx - 60, cy - 20], [cx - 66, cy + 560], 5, i * 1.1),
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
  addText(canvas, x, y, copy.download.heading, { size: 72, width: 900 });
  addText(canvas, x, y + 160, copy.download.body, {
    size: 25,
    color: MUTED,
    width: 800,
  });
  // Download buttons + iPad badge + footer links are DOM overlays; the canvas
  // leaves the band from y+260 to y+700 for them.
  hand(canvas, x + 640, y + 300, 'auto-updates\nincluded', GREEN, 36, 300);
  drawArrow(canvas, [x + 660, y + 400], [x + 480, y + 420], GREEN, 4);

  await addPage(
    canvas,
    r.x + 1230,
    r.y + 70,
    copy.download.faqTitle,
    copy.download.faqMarkdown,
  );

  addText(canvas, x, y + 900, copy.footer.tagline, { size: 30, width: 700 });
  addText(canvas, x, y + 980, copy.footer.privacyNote, {
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
