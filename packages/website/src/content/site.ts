/**
 * All marketing copy and canvas layout for the landing experience.
 *
 * This file is the single place to edit website copy. It feeds two renderers:
 *  - `src/pages/index.astro` renders every region's `article` block as static,
 *    crawlable HTML (the JS-off and mobile experience).
 *  - `src/canvas/seed.ts` places every region's `items` onto the live Myelin
 *    canvas (the desktop experience).
 *
 * Items are authored in each region's LOCAL coordinates (0,0 = the region's
 * top-left). `REGION_MOVES` translates each region onto a non-overlapping path
 * across the canvas, so you can lay out a region without worrying about where
 * it sits in the wider tour. Coordinates are world units (px at zoom 1).
 */

/** Ink colors mirror the app's palette tokens (see packages/ui/theme.css). */
export const INK = {
  text: '#191c1e',
  navy: '#2f3e46',
  red: '#e03e3e',
  green: '#005236',
  muted: '#5b6677',
  highlight: 'rgba(251, 191, 36, 0.45)',
} as const;

export const FONT = {
  heading: '"Newsreader", Georgia, serif',
  body: '"Hanken Grotesk", Arial, sans-serif',
  hand: '"Caveat", cursive',
} as const;

/** Pre-baked ink gestures the seeder can draw (see src/canvas/ink.ts). */
export type InkGesture =
  | { path: 'underline'; width: number }
  | { path: 'circle'; width: number; height: number }
  | { path: 'arrow'; dx: number; dy: number }
  | { path: 'zigzag'; width: number }
  | { path: 'points'; points: [number, number][] };

export type CanvasItem =
  | {
      kind: 'text';
      role: 'display' | 'heading' | 'body' | 'caption';
      text: string;
      x: number;
      y: number;
      width: number;
      /** Marks the note visitors are invited to edit. */
      editable?: boolean;
    }
  | {
      kind: 'handwriting';
      text: string;
      x: number;
      y: number;
      size?: number;
      width?: number;
      color?: string;
    }
  | {
      kind: 'ink';
      gesture: InkGesture;
      x: number;
      y: number;
      color?: string;
      size?: number;
      /** Draw this stroke on over ~0.7s when the canvas first loads. */
      animate?: boolean;
    }
  | {
      kind: 'shape';
      shape: 'rect' | 'ellipse' | 'line' | 'triangle';
      /** rect/ellipse: [x, y, w, h]; line/triangle: flat [x, y, ...] pairs. */
      geom: number[];
      x: number;
      y: number;
      color?: string;
      size?: number;
    }
  | { kind: 'latex'; source: string; x: number; y: number; scale?: number }
  | { kind: 'image'; src: string; x: number; y: number; scale?: number }
  | {
      /**
       * A DOM affordance anchored to world coordinates (real links and
       * buttons; canvas pixels cannot be clicked or tabbed to). `slot` names
       * which piece of chrome renders here — see WorldLayer.tsx.
       */
      kind: 'dom';
      slot: 'download-card' | 'schema-link' | 'scroll-hint';
      x: number;
      y: number;
      width: number;
    };

export interface RegionArticle {
  eyebrow: string;
  heading: string;
  body: string[];
  bullets?: string[];
}

export interface CanvasRegion {
  id: string;
  /** Command palette, progress rail, and app-tab label. */
  label: string;
  frame: { x: number; y: number; width: number; height: number };
  items: CanvasItem[];
  article: RegionArticle;
}

const authoredRegions: CanvasRegion[] = [
  {
    id: 'welcome',
    label: 'Welcome',
    frame: { x: 0, y: 0, width: 1560, height: 980 },
    items: [
      {
        kind: 'handwriting',
        text: 'this is the actual app. scroll to walk the notebook.',
        x: 72,
        y: 58,
        size: 30,
        color: INK.muted,
        width: 440,
      },
      {
        kind: 'text',
        role: 'display',
        text: 'Handwriting, type, and PDFs in one note',
        x: 68,
        y: 176,
        width: 520,
      },
      {
        kind: 'ink',
        gesture: { path: 'circle', width: 214, height: 88 },
        x: 352,
        y: 232,
        color: INK.red,
        size: 5,
        animate: true,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'A local-first canvas where you write with the pen, type rich text, and mark up PDFs in the same document. Most tools make you pick one lane. This is the workspace that is both.',
        x: 72,
        y: 440,
        width: 470,
      },
      { kind: 'dom', slot: 'download-card', x: 72, y: 620, width: 380 },
      // The product itself, as a note on the desk.
      { kind: 'image', src: '/canvas/shot-note.png', x: 760, y: 150, scale: 0.34 },
      { kind: 'image', src: '/canvas/sticky-amber.png', x: 1290, y: 96, scale: 0.28 },
      {
        kind: 'handwriting',
        text: 'the pen is on. scribble anywhere here.',
        x: 150,
        y: 800,
        size: 30,
        color: INK.red,
        width: 340,
      },
      {
        kind: 'ink',
        gesture: { path: 'arrow', dx: 60, dy: 54 },
        x: 250,
        y: 870,
        color: INK.red,
        size: 4,
        animate: true,
      },
      { kind: 'dom', slot: 'scroll-hint', x: 700, y: 900, width: 220 },
    ],
    article: {
      eyebrow: 'A native knowledge workspace',
      heading: 'Handwriting, type, and PDFs in one note',
      body: [
        'Myelin Notes is a native, local-first canvas where you write with the pen, type in rich text, annotate PDFs, and drop in images and audio, all in the same document, all kept on your own machine. Most tools make you pick one lane. This is the workspace that is both.',
        'On a desktop browser this page opens the real canvas engine so you can scroll through a working notebook, draw ink, and type into it. On this device you get the readable version, and the download is one tap away.',
      ],
    },
  },
  {
    id: 'ink-and-type',
    label: 'Ink and type',
    frame: { x: 0, y: 0, width: 1440, height: 940 },
    items: [
      {
        kind: 'text',
        role: 'heading',
        text: 'Write by hand or by keyboard, on the same page',
        x: 60,
        y: 56,
        width: 600,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'Draw with a pressure-sensitive pen and let rough strokes snap into clean lines, rectangles, ellipses, and triangles when you pause. Type into text boxes or open a rich-text frame with headings, tables, code, and math. Everything on this page is one of those elements.',
        x: 60,
        y: 226,
        width: 500,
      },
      {
        kind: 'ink',
        gesture: { path: 'underline', width: 240 },
        x: 62,
        y: 402,
        color: INK.highlight,
        size: 28,
      },
      // A real, editable note the visitor can type into.
      {
        kind: 'text',
        role: 'body',
        text: 'Double-click me and type something. This is a real text box.',
        x: 760,
        y: 170,
        width: 380,
        editable: true,
      },
      {
        kind: 'ink',
        gesture: { path: 'circle', width: 430, height: 140 },
        x: 738,
        y: 148,
        color: INK.navy,
        size: 4,
      },
      {
        kind: 'handwriting',
        text: 'the margin is for thinking',
        x: 790,
        y: 340,
        size: 31,
        color: INK.red,
      },
      {
        kind: 'ink',
        gesture: { path: 'underline', width: 290 },
        x: 794,
        y: 386,
        color: INK.red,
        size: 4,
      },
      { kind: 'image', src: '/canvas/sticky-mint.png', x: 1150, y: 470, scale: 0.32 },
      {
        kind: 'shape',
        shape: 'triangle',
        geom: [75, 0, 150, 110, 0, 110],
        x: 640,
        y: 600,
        color: INK.navy,
        size: 3,
      },
      {
        kind: 'shape',
        shape: 'ellipse',
        geom: [0, 0, 150, 96],
        x: 820,
        y: 610,
        color: INK.navy,
        size: 3,
      },
      {
        kind: 'handwriting',
        text: 'drew a blob, held still, got a shape',
        x: 620,
        y: 750,
        size: 27,
        color: INK.muted,
        width: 250,
      },
      {
        kind: 'handwriting',
        text: 'highlighter, eraser, undo... real tools, down there',
        x: 90,
        y: 660,
        size: 29,
        color: INK.muted,
        width: 300,
      },
      {
        kind: 'ink',
        gesture: { path: 'arrow', dx: -10, dy: 110 },
        x: 200,
        y: 760,
        color: INK.muted,
        size: 4,
      },
    ],
    article: {
      eyebrow: 'The canvas',
      heading: 'Write by hand or by keyboard, on the same page',
      body: [
        'Draw with a pressure-sensitive pen and let rough strokes snap into clean lines, rectangles, ellipses, and triangles when you pause. Highlight, erase, and pick colors from a radial wheel. Drop in editable text boxes, or open a rich-text frame with headings, lists, tables, code blocks, and LaTeX math.',
      ],
      bullets: [
        'Pressure-sensitive pen with shape recognition for lines, rectangles, ellipses, and triangles',
        'Highlighter, eraser, and a radial color wheel',
        'Rich-text frames with headings, lists, tables, code blocks, and LaTeX math',
        'Select, move, rotate, resize, and reorder any element, with full undo and redo',
      ],
    },
  },
  {
    id: 'math',
    label: 'Math',
    frame: { x: 0, y: 0, width: 1180, height: 820 },
    items: [
      {
        kind: 'text',
        role: 'heading',
        text: 'Math renders where you wrote it',
        x: 60,
        y: 56,
        width: 540,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'Write LaTeX inline in a note or drop a block straight onto the canvas. The formulas on your screen are being rendered live, right now, by the same engine the app uses.',
        x: 60,
        y: 190,
        width: 440,
      },
      {
        kind: 'latex',
        source:
          '\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi i x \\xi}\\, dx',
        x: 620,
        y: 90,
        scale: 1.6,
      },
      {
        kind: 'latex',
        source: 'e^{i\\pi} + 1 = 0',
        x: 700,
        y: 270,
        scale: 1.9,
      },
      {
        kind: 'ink',
        gesture: { path: 'circle', width: 300, height: 110 },
        x: 660,
        y: 250,
        color: INK.red,
        size: 4,
      },
      {
        kind: 'handwriting',
        text: 'still the prettiest equation',
        x: 720,
        y: 390,
        size: 29,
        color: INK.red,
      },
      {
        kind: 'handwriting',
        text: 'derivation from the lecture:',
        x: 62,
        y: 420,
        size: 28,
        color: INK.navy,
      },
      {
        kind: 'ink',
        gesture: { path: 'zigzag', width: 320 },
        x: 66,
        y: 490,
        color: INK.navy,
        size: 3,
      },
      {
        kind: 'ink',
        gesture: { path: 'zigzag', width: 260 },
        x: 66,
        y: 540,
        color: INK.navy,
        size: 3,
      },
      {
        kind: 'ink',
        gesture: { path: 'zigzag', width: 300 },
        x: 66,
        y: 590,
        color: INK.navy,
        size: 3,
      },
    ],
    article: {
      eyebrow: 'Math',
      heading: 'Math renders where you wrote it',
      body: [
        'Write LaTeX inline in a rich-text frame or drop a block straight onto the canvas. KaTeX renders it in place, next to the handwritten derivation it belongs to.',
      ],
    },
  },
  {
    id: 'pdf',
    label: 'PDFs',
    frame: { x: 0, y: 0, width: 1360, height: 980 },
    items: [
      {
        kind: 'text',
        role: 'heading',
        text: 'Mark up the paper, next to your notes',
        x: 60,
        y: 56,
        width: 520,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'Embed a multi-page PDF, reorder its pages, and draw directly on top. Record audio with live on-device transcription. Import from GoodNotes exports and Obsidian vaults. The reading and the thinking stay on one surface.',
        x: 60,
        y: 190,
        width: 450,
      },
      { kind: 'image', src: '/canvas/shot-pdf.png', x: 700, y: 20, scale: 0.3 },
      {
        kind: 'handwriting',
        text: 'a real PDF: pages, ink, highlights, export',
        x: 60,
        y: 440,
        size: 29,
        color: INK.muted,
        width: 360,
      },
      {
        kind: 'ink',
        gesture: { path: 'arrow', dx: 210, dy: -70 },
        x: 470,
        y: 470,
        color: INK.muted,
        size: 4,
      },
      {
        kind: 'handwriting',
        text: 'whisper transcribes audio on-device, as you talk',
        x: 60,
        y: 640,
        size: 28,
        color: INK.navy,
        width: 380,
      },
    ],
    article: {
      eyebrow: 'PDFs and audio',
      heading: 'Bring in PDFs and recordings, and work on them in place',
      body: [
        'Embed a multi-page PDF, reorder its pages, insert blank pages, and draw annotations directly on top. Record audio straight into a note with a live waveform, and Whisper transcribes it on-device as you speak, with nothing sent to the cloud. The transcript becomes part of the note, and part of what you can search.',
      ],
      bullets: [
        'Embed and annotate multi-page PDFs, and reorder, delete, or insert pages',
        'Import from GoodNotes exports and Obsidian vaults',
        'Record audio with live, on-device Whisper transcription',
        'Embed images with drag-to-resize and crop',
      ],
    },
  },
  {
    id: 'connections',
    label: 'Connections',
    frame: { x: 0, y: 0, width: 1520, height: 960 },
    items: [
      {
        kind: 'text',
        role: 'heading',
        text: 'Notes that know each other',
        x: 60,
        y: 56,
        width: 520,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'Link notes with [[double brackets]] and follow them both ways. The graph view shows the shape of what you know. Search by keyword or by idea, with an embedding model that runs on your device, and find even the words you wrote by hand.',
        x: 60,
        y: 190,
        width: 470,
      },
      { kind: 'image', src: '/canvas/shot-graph.png', x: 800, y: 10, scale: 0.32 },
      {
        kind: 'handwriting',
        text: 'the graph draws itself',
        x: 60,
        y: 430,
        size: 29,
        color: INK.muted,
      },
      {
        kind: 'ink',
        gesture: { path: 'arrow', dx: 320, dy: -30 },
        x: 400,
        y: 445,
        color: INK.muted,
        size: 4,
      },
      { kind: 'image', src: '/canvas/shot-search.png', x: 130, y: 540, scale: 0.3 },
      {
        kind: 'handwriting',
        text: 'search finds my handwriting?!',
        x: 780,
        y: 640,
        size: 31,
        color: INK.green,
        width: 300,
      },
      {
        kind: 'ink',
        gesture: { path: 'underline', width: 260 },
        x: 784,
        y: 718,
        color: INK.green,
        size: 4,
      },
      {
        kind: 'ink',
        gesture: { path: 'arrow', dx: -60, dy: 40 },
        x: 770,
        y: 690,
        color: INK.green,
        size: 4,
      },
    ],
    article: {
      eyebrow: 'Connections and search',
      heading: 'Notes that know each other',
      body: [
        'Link notes with double brackets and follow them both ways. The graph view shows the shape of what you know.',
        'Search your whole library by keyword, or switch to semantic search to find notes by idea rather than exact wording. The embedding model runs locally on your device. Inside a note, a find bar matches text, page frames, audio transcripts, and recognized handwriting.',
      ],
      bullets: [
        'Bidirectional links and a graph view of your workspace',
        'Keyword and on-device semantic search across your library',
        'Handwriting recognition and search on macOS, via Apple Vision',
      ],
    },
  },
  {
    id: 'local-first',
    label: 'Local-first',
    frame: { x: 0, y: 0, width: 1440, height: 900 },
    items: [
      {
        kind: 'text',
        role: 'heading',
        text: 'Your notes live on your machine',
        x: 60,
        y: 56,
        width: 560,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'The library is files on your own disk. Everything works offline: opening, editing, and searching a note never touches a server. Version history keeps snapshots you can restore, and you can export the whole workspace to one complete file, any time.',
        x: 60,
        y: 190,
        width: 470,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'Sync is optional and it is yours: through a GitHub repository you own, or live between your machines over a direct connection. No Myelin account exists to sign up for.',
        x: 60,
        y: 400,
        width: 470,
      },
      { kind: 'image', src: '/canvas/shot-library.png', x: 700, y: 20, scale: 0.31 },
      {
        kind: 'handwriting',
        text: 'plain files. open format. your disk.',
        x: 800,
        y: 470,
        size: 28,
        color: INK.muted,
        width: 320,
      },
      {
        kind: 'handwriting',
        text: 'we will never take your notes away.',
        x: 60,
        y: 580,
        size: 34,
        color: INK.text,
        width: 440,
      },
      {
        kind: 'ink',
        gesture: { path: 'underline', width: 400 },
        x: 64,
        y: 668,
        color: INK.red,
        size: 5,
      },
      { kind: 'dom', slot: 'schema-link', x: 64, y: 720, width: 260 },
    ],
    article: {
      eyebrow: 'Local-first',
      heading: 'Your notes live on your machine',
      body: [
        'Myelin Notes keeps your library on your own disk and works fully offline. Your notes never leave your control. Version history keeps snapshots you can look back on and restore, and you can export your whole workspace to a complete file that preserves everything, any time, no questions asked.',
        'Sync is optional, and it is yours. Sync a note through a GitHub repository you own, or edit it live on two machines at once: changes connect directly between your devices, coordinated by a small discovery service that helps them find each other but never stores your notes.',
        'We will never put your own notes behind a paywall, and we will never lock you out. Whatever happens, you can export everything and walk away with all of it.',
      ],
      bullets: [
        'Local-first storage that works offline',
        'Version history with restore',
        'Export to Markdown, PDF, an Obsidian vault, or a complete workspace file',
        'Optional sync through your own GitHub repository, or live between your computers',
      ],
    },
  },
  {
    id: 'download',
    label: 'Download',
    frame: { x: 0, y: 0, width: 1240, height: 860 },
    items: [
      {
        kind: 'text',
        role: 'heading',
        text: 'Take the notebook home',
        x: 60,
        y: 56,
        width: 520,
      },
      {
        kind: 'text',
        role: 'body',
        text:
          'Myelin Notes is free while it is in early access, and the whole editor is in your hands: the canvas, pen and handwriting tools, PDFs and audio, import and export, local-first storage, and sync across your own computers. No account needed to start.',
        x: 60,
        y: 190,
        width: 500,
      },
      { kind: 'dom', slot: 'download-card', x: 700, y: 130, width: 400 },
      { kind: 'image', src: '/canvas/sticky-mint.png', x: 760, y: 380, scale: 0.3 },
      {
        kind: 'handwriting',
        text: 'this canvas stays in your browser. the real one is faster :)',
        x: 60,
        y: 460,
        size: 30,
        color: INK.muted,
        width: 400,
      },
      {
        kind: 'ink',
        gesture: { path: 'arrow', dx: 150, dy: -120 },
        x: 500,
        y: 440,
        color: INK.green,
        size: 4,
      },
    ],
    article: {
      eyebrow: 'Early access',
      heading: 'Free while Myelin Notes is in early access',
      body: [
        'Myelin Notes is in early access and free to use right now. The whole editor is in your hands: the canvas, pen and handwriting tools, PDFs and audio, import and export, local-first storage, GitHub sync, and live editing across your own computers. No account is needed to start. Sign in with GitHub only when you want to sync.',
      ],
    },
  },
];

/**
 * Where each region's local (0,0) origin lands on the canvas. The path is a
 * gentle serpentine with generous gaps so no region's content bleeds into a
 * neighbor's framed view. To move a region on the tour, change its origin here;
 * to re-author its contents, edit the local item coordinates above.
 */
const REGION_MOVES: Record<string, [number, number]> = {
  welcome: [0, 0],
  'ink-and-type': [1950, 120],
  math: [2250, 1450],
  pdf: [250, 1650],
  connections: [250, 3000],
  'local-first': [2150, 3050],
  download: [3950, 3000],
};

function shiftItem(item: CanvasItem, dx: number, dy: number): CanvasItem {
  if (
    item.kind === 'shape' &&
    (item.shape === 'line' || item.shape === 'triangle')
  ) {
    // Line/triangle geometry is authored in absolute coordinates (element
    // offset stays at 0), so the points move, not the offset.
    const geom = item.geom.map((value, index) =>
      index % 2 === 0 ? value + dx : value + dy,
    );
    return { ...item, geom };
  }
  return { ...item, x: item.x + dx, y: item.y + dy };
}

export const regions: CanvasRegion[] = authoredRegions.map((region) => {
  const [dx, dy] = REGION_MOVES[region.id] ?? [0, 0];
  return {
    ...region,
    frame: {
      ...region.frame,
      x: region.frame.x + dx,
      y: region.frame.y + dy,
    },
    items: region.items.map((item) => shiftItem(item, dx, dy)),
  };
});

/** Desktop platforms resolve from the updater manifest at load time. */
export const downloadPlatforms = [
  { name: 'macOS', available: true },
  { name: 'Windows', available: true },
  { name: 'Linux', available: true },
  { name: 'iPad', available: false },
  { name: 'Android', available: false },
] as const;

export const faqs = [
  {
    q: 'Do I need an account?',
    a: 'No Myelin Notes account. The app runs locally; you sign in with GitHub only if you want to sync across your own computers.',
  },
  {
    q: 'Does it work offline?',
    a: 'Fully. Everything runs on your machine, and there is no server call to open, edit, or search a note. Only optional GitHub sync touches the network.',
  },
  {
    q: 'Is it really free?',
    a: 'Free while Myelin Notes is in early access. The whole editor, with no tiers and no trial to expire.',
  },
  {
    q: 'Where do my notes live?',
    a: 'On your own disk. You can export your whole workspace to a complete file that preserves everything, any time.',
  },
] as const;

export const siteTitle =
  'Myelin Notes: handwriting, type, and PDFs in one note';
export const siteDescription =
  'Myelin Notes is a native, local-first canvas where handwriting, type, PDFs, images, and audio live in one note, kept on your own machine. Free while it is in early access.';
