import type { SiteCopy } from './index';

/**
 * Site style: no em dashes.
 */
const en: SiteCopy = {
  meta: {
    title:
      'Myelin Notes: a local-first note-taking app for handwriting, type, and PDFs',
    description:
      'Myelin Notes is a native, local-first note-taking app for Mac, Windows, and Linux, with iPhone, iPad, and Android on the way: one canvas where handwriting, type, PDFs, images, and audio live in the same note, on your own device. Completely free for personal use.',
  },

  topbar: {
    nav: 'Site',
    download: 'Download',
    language: 'Language',
  },

  /** Rail dots on the canvas, and the section kickers on the static page. */
  sceneLabels: {
    hero: 'Myelin',
    ink: 'PDFs',
    pages: 'Pages',
    'audio-search': 'Audio & search',
    linked: 'Linked notes',
    sync: 'Sync & collab',
    'local-first': 'Local-first',
    import: 'Import',
    download: 'Download',
  },
  /** The one static-page section with no scene of its own. */
  faqKicker: 'Questions',

  hero: {
    // The canvas names the product in the topbar wordmark it flies over; the
    // static page has no such anchor, so it labels the hero directly. Keeps the
    // hero readable as a standalone chunk, which is how crawlers and answer
    // engines lift it.
    eyebrow: 'Myelin Notes · a local-first note-taking app',
    headline: 'Handwriting, typing,\nand PDFs. One note.',
    subheadline:
      'Myelin Notes is a native, local-first note-taking app: one canvas where ink, rich text, PDFs, images, and audio live together. Your notes stay on your machine, and you can still edit live with others, no server required.',
    trustLine:
      'Completely free for personal use · No account required · Your notes are never paywalled',
    ctaPrimary: 'Download',
    ctaSecondary: 'See it in action',
  },

  ink: {
    annotation: 'draw a shape + hold. try it!',
    recognized: 'recognized!',
    pdfHeading: 'Write directly\non your PDFs.',
    pdfBody:
      'Drop a PDF onto the canvas and mark it up in the same ink as everything else: circle an equation, highlight a line, scribble in the margins. When you are done, export the annotated PDF back out.',
    pdfAnnotation: 'ink goes right on the page',
  },

  pages: {
    heading: 'Real documents,\nright on the canvas.',
    body: 'Page frames are full rich-text documents: Markdown shortcuts, headings, lists and checkboxes, tables, math, and code blocks you can run.',
    annotation: 'a real, editable page. click into it.',
    pageTitle: 'Lecture 12 · Action potentials',
    pageMarkdown: `# Action potentials

The neuron's resting potential sits near **-70 mV**, held by the sodium-potassium pump.

## Today

- [x] Resting potential recap
- [ ] Depolarization and the Na+ channel cascade
- [ ] Why myelin makes conduction fast

| Phase | Channel | Direction |
| --- | --- | --- |
| Depolarize | Na+ opens | inward |
| Repolarize | K+ opens | outward |

The membrane potential follows:

$$V_m = \\frac{RT}{F} \\ln \\frac{[K^+]_{out}}{[K^+]_{in}}$$

\`\`\`python
tau = 2.0  # membrane time constant, ms
v = -70.0
for step in range(3):
    v += (0 - v) / tau
    print(round(v, 1))
\`\`\`
`,
  },

  audioSearch: {
    heading: 'Record it. Find it.\nEven your handwriting.',
    audioBody:
      'Record lectures or meetings on the canvas. A bundled Whisper base model transcribes them on-device, so every recording is searchable and no audio leaves your machine.',
    searchBody:
      'Full-text and semantic search run locally, on a bundled all-MiniLM-L6-v2 model. Handwriting is recognized on macOS through Apple’s Vision framework, and audio transcripts are searchable too.',
    // Content of the mock app cards standing in for real screenshots
    // (see world-layer.tsx).
    audioMock: {
      title: 'Lecture 12 · Action potentials',
      duration: '48:12',
      transcriptLabel: 'Transcript · on-device',
      transcript:
        '…the myelin sheath insulates the axon, so the signal jumps from node to node instead of crawling…',
      match: 'myelin sheath',
    },
    searchMock: {
      query: 'node of ranvier',
      results: [
        {
          kind: 'page',
          title: 'Lecture 12 · Action potentials',
          snippet: '…the signal jumps between nodes of Ranvier…',
        },
        {
          kind: 'ink',
          title: 'Whiteboard · myelination sketch',
          snippet: 'Handwriting match, OCR on-device',
        },
        {
          kind: 'audio',
          title: 'Recording · Lecture 12',
          snippet: 'Transcript match at 31:42',
        },
      ],
    },
  },

  linked: {
    heading: 'Your notes, connected.',
    body: '[[Note links]], backlinks, and hover preview cards keep related ideas one hop away. The command palette jumps you anywhere, and per-file version history restores any earlier state of a note.',
  },

  importing: {
    heading: 'Bring your old notes\nwith you.',
    body: 'Import your notes from other apps',
    annotation: 'no copying and pasting.',
    sources: [
      {
        id: 'goodnotes',
        label: 'Import from Goodnotes',
        detail:
          'Import your Goodnotes content by exporting it as a zip of PDFs.',
      },
      {
        id: 'onenote',
        label: 'Import from OneNote',
        detail:
          'Import your OneNote content from a .onepkg notebook or .one section.',
      },
      {
        id: 'obsidian',
        label: 'Import from Obsidian',
        detail: 'Import your Obsidian content with the vault folder.',
      },
      {
        id: 'notion',
        label: 'Import from Notion',
        detail:
          'Import your Notion content by exporting it as Markdown and CSV.',
      },
    ],
  },

  localFirst: {
    heading: 'It all lives\non your machine.',
    lede: 'No cloud in the middle. Your notes are ordinary files on your own disk, and Myelin works completely offline.',
    bullets: [
      'Your notes are plain files on your disk, in an open, conflict-free format (Yjs). Nothing is ever locked in.',
      'Everything works fully offline, with no account and no server in the middle.',
      'Search, semantic embeddings, and handwriting OCR (macOS) all run on your own machine.',
      'Bring your own AI: models connect through a local MCP server, never a cloud we chose for you.',
      'Import from Obsidian or GoodNotes, export to PDF, images, or JSON, and read every line of source on GitHub.',
    ],
  },

  sync: {
    heading: 'Sync and collaborate,\nno server in the middle.',
    kicker:
      'Real-time editing normally means a server holding your notes. Myelin connects the devices directly instead.',
    cursorYou: 'you',
    cursorPeer: 'ada',
    sharedNote: 'same note,\ntwo machines',
    tiers: [
      {
        shipped: true,
        badge: 'Today',
        title: 'Live collaboration',
        body: 'Two devices with the same note open find each other automatically, then edit in step over an encrypted QUIC connection straight between them (iroh).',
      },
      {
        shipped: true,
        badge: 'Today',
        title: 'GitHub sync',
        body: 'Point Myelin at a repo and branch, and your workspace syncs across devices through a repo you control.',
      },
      {
        shipped: false,
        badge: 'Coming soon',
        title: 'Invites',
        body: 'Bring someone into a single note without handing over the whole repo, with owner, editor, and viewer roles deciding what they can do.',
      },
    ],
  },

  download: {
    heading: 'Download',
    body: 'Available in English, Spanish, French, and Simplified Chinese.',
    cta: 'Download Myelin Notes',
    autoUpdates: 'auto-updates\nincluded',
    platforms: [
      {
        key: 'mac',
        name: 'macOS',
        label: 'Download for macOS',
        sub: 'macOS 10.15+',
      },
      {
        key: 'windows',
        name: 'Windows',
        label: 'Download for Windows',
        sub: 'Windows 10+',
      },
      {
        key: 'linux',
        name: 'Linux',
        label: 'Download for Linux',
        sub: 'AppImage',
      },
      {
        key: 'ios',
        name: 'iOS',
        label: 'Download for iOS',
        sub: 'iPhone and iPad',
      },
      {
        key: 'android',
        name: 'Android',
        label: 'Download for Android',
        sub: 'Phone and tablet',
      },
    ],
    otherPlatforms: 'Also available for',
    comingSoon: 'Coming soon',
    mobileBadge:
      'iPhone, iPad, and Android are on the way: the same notes, not a cut-down viewer',
    faqTitle: 'FAQ',
    faqMarkdown: `# FAQ

## Is it really free?

Yes, completely free for personal use.

## Where are my notes stored?

Locally, as files on your machine. Optional GitHub sync if you want them in a repo you control.

## Do I need an account?

No. Myelin Notes has no account system at all: you download it, open it, and your notes are on your disk. You sign in with GitHub only if you turn on GitHub sync, and that is your account with GitHub, not one with us.

## Is it open source?

Not quite. The source is public, so anyone can read it and check what the app does with their notes, and it is free to use for personal and other noncommercial purposes. It is licensed under PolyForm Strict 1.0.0, which means you cannot redistribute it or publish modified versions, and commercial use needs a separate license.

## Can I collaborate with others?

Yes, live and peer to peer, today. There is no Myelin account and nothing sitting in the middle. Devices find each other through GitHub sync, so both ends need access to the same repo. Shared notebooks with permissions arrive in v1.0.

## Can I import from another app?

Yes. Myelin imports an Obsidian vault, a OneNote .onepkg notebook or .one section, a Goodnotes folder exported as PDFs, loose Markdown, PDFs, images, and video, and a workspace folder exported from Myelin itself. Notion comes across through its own Markdown and CSV export, which the file importer reads; a dedicated Notion importer that keeps the page hierarchy is on the roadmap.

## Does it work offline?

Fully. Editing, full-text and semantic search, handwriting recognition, audio transcription, PDF annotation, and export all run on your own machine, so the app behaves identically with the network off. Only GitHub sync and live collaboration need a connection, and both are optional.

## What about iPhone, iPad, and Android?

Coming soon. Today Myelin Notes runs on Mac, Windows, and Linux. The mobile apps are in development, and they are native builds rather than a cut-down viewer: the same notes, the same canvas, and the same sync as the desktop apps, with Apple Pencil on iPad and an S Pen or active stylus on Android.
`,
  },

  /** Labels for the shared link set; the hrefs live in `index.ts`. */
  linkLabels: {
    privacy: 'Privacy',
    support: 'Support',
  },

  footer: {
    nav: 'Footer',
    tagline: 'Handwriting, typing, and PDFs. One note.',
    download: 'Download Myelin',
    platforms: 'Mac · Windows · Linux · iPhone, iPad, and Android coming soon',
  },

  /** Alt text for the static page's screenshots. */
  shots: {
    library:
      'The Myelin Notes library with folders, note cards, tags, and search',
    pdf: 'A PDF embedded on the Myelin canvas, with an equation boxed and an arrow drawn in ink beside it',
    pageFrame:
      'A Myelin page frame with headings, note links, a checklist, inline math, and code blocks running with their output beside them',
    audio:
      'A recording on the Myelin canvas, its waveform drawn as it captures',
    graph:
      "The Myelin Notes graph view, showing a note's outgoing links and backlinks",
  },

  /** Canvas-only chrome: the scene rail, the palette, and the color prompt. */
  canvas: {
    rail: {
      label: 'Sections',
      previous: 'Previous section',
      next: 'Next section',
      scrollHint: 'Scroll to explore',
    },
    palette: {
      label: 'Command palette',
      placeholder: 'Jump anywhere in the notebook',
      empty: 'Nothing matches. Try a scene name or "download".',
      groupGoTo: 'Go to',
      groupGetIt: 'Get it',
      download: 'Download Myelin Notes',
    },
    addCustomColor: 'Add a custom color (hex, e.g. #3b82f6)',
  },

  /**
   * Hand-drawn ink that decorates specific words in a headline, so its geometry
   * depends on how long that headline is in this language. Offsets are world
   * units from each scene's own text origin (see `src/canvas/scenes.ts`).
   *
   * These are the one thing here that cannot be checked by reading: they are
   * tuned against rendered glyph widths. Load the canvas in the locale you
   * changed and look, rather than trusting the numbers to carry over. The
   * values below are the ones the English canvas was designed around.
   */
  decorations: {
    /** Under line 2 of the hero headline. */
    heroUnderline: { dx: 4, dy: 290, width: 540 },
    /** Highlighter over "your machine." in the local-first headline. */
    localFirstHighlight: { dx: 120, dy: 292, width: 382 },
    /** Under the last line of the sync kicker. */
    syncUnderline: { dx: 0, dy: 310, width: 480 },
  },
};

export default en;
