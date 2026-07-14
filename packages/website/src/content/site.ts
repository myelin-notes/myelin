export const siteTitle =
  'Myelin Notes: handwriting, type, and PDFs in one note';
export const siteDescription =
  'Myelin Notes is a native, local-first canvas where handwriting, type, PDFs, images, and audio live in one note, kept on your own machine. Free while it is in early access.';

/**
 * External destinations, centralized so a URL change is a one-line edit.
 * TODO(links): confirm the Discord invite, Sponsors, and Ko-fi URLs before
 * launch; the GitHub repo and releases links are real today.
 */
export const siteLinks = {
  github: 'https://github.com/myelin-notes/myelin',
  releases: 'https://github.com/myelin-notes/myelin/releases/latest',
  roadmap: 'https://github.com/myelin-notes/myelin/issues',
  license: 'https://github.com/myelin-notes/myelin/blob/main/LICENSE.md',
  discord: 'https://github.com/myelin-notes/myelin',
  sponsors: 'https://github.com/sponsors/winterSteve25',
  kofi: 'https://ko-fi.com/wintersteve25',
};

/**
 * All copy for the scrollytelling canvas, one entry per scene. Layout
 * (world coordinates) lives in `src/canvas/scenes.ts`; this file owns only the
 * words. Site style: no em dashes.
 */
export const copy = {
  hero: {
    headline: 'Handwriting, typing,\nand PDFs. One note.',
    subheadline:
      'A native, local-first canvas where ink, rich text, PDFs, images, and audio live together. Your notes stay on your machine, and you can still edit live with others, no server required.',
    trustLine:
      'Free while in early access · No account required · Your notes are never paywalled',
    ctaPrimary: 'Download',
    ctaSecondary: 'See it in action',
    tryIt: 'this whole page is the real canvas.\ntry drawing on it!',
  },

  ink: {
    heading: 'An infinite canvas that\nkeeps up with your pen.',
    body: 'Pressure-sensitive ink, a highlighter, an eraser, text, and images share one surface. Draw a rough rectangle and hold still: shape recognition swaps it for a clean one.',
    annotation: 'draw a shape + hold',
    recognized: 'recognized!',
    pdfHeading: 'PDFs are first-class citizens.',
    pdfBody:
      'Drop a PDF onto the canvas, read it, and write directly on it in the same ink. When you are done, export the annotated PDF back out.',
    pdfAnnotation: 'ink goes right on the page',
  },

  pages: {
    heading: 'Real documents,\nright on the canvas.',
    body: 'Page frames are full rich-text documents: Markdown shortcuts, headings, lists and checkboxes, tables, math, and code blocks you can run in Python, JavaScript, Rust, Go, C, and more.',
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
      'Record lectures or meetings on the canvas. On-device Whisper transcription makes every recording searchable.',
    searchBody:
      'Full-text and semantic search run entirely on your machine with bundled MiniLM embeddings. Handwriting is OCR’d and searchable. Audio transcripts are searchable too.',
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
          kind: 'page' as const,
          title: 'Lecture 12 · Action potentials',
          snippet: '…the signal jumps between nodes of Ranvier…',
        },
        {
          kind: 'ink' as const,
          title: 'Whiteboard · myelination sketch',
          snippet: 'Handwriting match, OCR on-device',
        },
        {
          kind: 'audio' as const,
          title: 'Recording · Lecture 12',
          snippet: 'Transcript match at 31:42',
        },
      ],
    },
  },

  linked: {
    heading: 'Your notes, connected.',
    body: '[[Note links]], backlinks, and hover preview cards keep related ideas one hop away. The command palette jumps you anywhere, and per-file version history restores any earlier state of a note.',
    notes: [
      '[[action potentials]]',
      '[[myelin sheath]]',
      '[[node of ranvier]]',
    ],
    annotation: 'backlinks both ways',
  },

  localFirst: {
    heading: 'Local-first is the whole point.',
    bullets: [
      'Your notes are files on your machine. Fully offline, no account, no server required.',
      'CRDT-based note format (Yjs), so nothing is ever lost to a sync conflict.',
      'Telemetry is minimal: crash reports and a few product events, no session recording. You can turn all of it off in settings.',
      'Credentials like your GitHub token live in an encrypted vault (Stronghold).',
      'Source available on GitHub under FSL-1.1, converting to Apache 2.0 after two years.',
    ],
    cta: 'View the source on GitHub',
    lockInHeading: 'No lock-in.\nBring your own AI.',
    importBody:
      'Import from Obsidian and GoodNotes today; a Notion importer is on the roadmap. Export to PDF, images, or full workspace JSON. Your data leaves as easily as it arrives.',
    mcpBody:
      'A built-in MCP server lets Claude, or any MCP client, read and create notes locally. No cloud AI is ever forced on you.',
    importLabel: 'obsidian · goodnotes → in',
    exportLabel: 'pdf · images · json → out',
  },

  sync: {
    heading: 'Sync and collaborate,\nno server in the middle.',
    kicker:
      'Real-time collaboration is usually the excuse for putting your notes in someone’s cloud. Myelin does it without one.',
    cursorYou: 'you',
    cursorPeer: 'ada',
    sharedNote: 'same note,\ntwo machines,\nzero servers',
    tiers: [
      {
        badge: 'Today',
        title: 'Live collaboration',
        body: 'Invite someone into a note and edit together in real time, peer to peer over iroh. Ink, text, and annotations sync live, with owner, editor, and viewer roles.',
      },
      {
        badge: 'Today',
        title: 'GitHub sync',
        body: 'Point Myelin at a repo and branch, and your workspace syncs across devices through infrastructure you already control.',
      },
      {
        badge: 'Coming',
        title: 'Myelin Sync',
        body: 'Optional end-to-end encrypted cloud sync for always-on, multi-device sync. Founding Supporters get a lifetime discount when it launches.',
      },
    ],
  },

  supporter: {
    heading: 'Free during early access.\nNever a paywall on your notes.',
    body: 'The editor and your notes stay free. If you want Myelin to exist long-term, become a Founding Supporter.',
    benefits: [
      'Early insider builds',
      'Supporters Discord',
      'Founding Supporter badge',
      'Lifetime discount on Myelin Sync when it launches',
    ],
    reassurance: 'None of these benefits gate the editor or your notes.',
    ctaPrimary: 'Sponsor on GitHub',
    ctaSecondary: 'Support on Ko-fi',
  },

  download: {
    heading: 'Take your notes home.',
    body: 'Native builds with auto-updates built in. English, Spanish, and Simplified Chinese today.',
    platforms: [
      { key: 'mac', label: 'Download for macOS', sub: 'macOS 10.15+' },
      { key: 'windows', label: 'Download for Windows', sub: 'Windows 10+' },
      { key: 'linux', label: 'Download for Linux', sub: 'AppImage' },
    ],
    ipadBadge: 'iPad app coming (v0.8)',
    faqTitle: 'FAQ',
    faqMarkdown: `# FAQ

## Is it really free?

Yes, during early access. The editor and your notes stay free forever; a paid, optional Sync service comes later.

## Where are my notes stored?

Locally, as files on your machine. Optional GitHub sync if you want them in a repo you control.

## Do I need an account?

No.

## Is it open source?

Source available under FSL-1.1, and each release converts to Apache 2.0 after two years.

## Can I collaborate with others?

Yes, live, peer to peer, today. No account or server needed. Shared notebooks with permissions arrive in v1.0.

## Can I import from Obsidian or GoodNotes?

Yes, both. A Notion importer is on the roadmap.

## Does it work offline?

Fully.

## What about iPad and stylus support?

A stylus works on desktop today through pen input. The iPad app is on the roadmap (v0.8).
`,
  },

  footer: {
    tagline: 'Handwriting, typing, and PDFs. One note.',
    privacyNote:
      'Telemetry: crash reports and a few product events only, and you can disable all of it in settings.',
    links: [
      { label: 'GitHub', href: siteLinks.github },
      { label: 'Roadmap', href: siteLinks.roadmap },
      { label: 'Discord', href: siteLinks.discord },
      { label: 'Sponsor', href: siteLinks.sponsors },
      { label: 'Ko-fi', href: siteLinks.kofi },
      { label: 'License', href: siteLinks.license },
    ],
    download: 'Download Myelin',
  },
};
