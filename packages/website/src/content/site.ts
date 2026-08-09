export const siteTitle =
  'Myelin Notes: a local-first note-taking app for handwriting, type, and PDFs';
export const siteDescription =
  'Myelin Notes is a native, local-first note-taking app for Mac, Windows, Linux, iOS, and Android: one canvas where handwriting, type, PDFs, images, and audio live in the same note, on your own device. Completely free for personal use.';

/**
 * External destinations, centralized so a URL change is a one-line edit.
 */
export const siteLinks = {
  github: 'https://github.com/myelin-notes/myelin',
  releases: 'https://github.com/myelin-notes/myelin/releases/latest',
  /** Latest stable release, as JSON: where `src/lib/downloads.ts` finds the
   *  per-platform installer asset behind every download button. */
  latestReleaseApi:
    'https://api.github.com/repos/myelin-notes/myelin/releases/latest',
  roadmap: 'https://github.com/myelin-notes/myelin/issues',
  license: 'https://github.com/myelin-notes/myelin/blob/main/LICENSE.md',
};

/** Every platform Myelin ships a native build for. */
export type PlatformKey = 'mac' | 'windows' | 'linux' | 'ios' | 'android';

export interface Platform {
  key: PlatformKey;
  /** Bare platform, for lists where repeating "Download for" would grate. */
  name: string;
  /** Full call to action, for wherever a platform stands on its own. */
  label: string;
  /** Minimum version or artifact kind. */
  sub: string;
}

/**
 * All copy for the scrollytelling canvas, one entry per scene. Layout
 * (world coordinates) lives in `src/canvas/scenes.ts`; this file owns only the
 * words. Site style: no em dashes.
 */
export const copy = {
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
    body: 'Page frames are full rich-text documents: Markdown shortcuts, headings, lists and checkboxes, tables, math, and code blocks you can run in nine languages, right in the note. Python, JavaScript, TypeScript, Ruby, Bash, Go, Rust, C, and C++.',
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
        badge: 'Today',
        title: 'Live collaboration',
        body: 'Two devices with the same note open find each other automatically, then edit in step over an encrypted QUIC connection straight between them (iroh).',
      },
      {
        badge: 'Today',
        title: 'GitHub sync',
        body: 'Point Myelin at a repo and branch, and your workspace syncs across devices through a repo you control.',
      },
      {
        badge: 'Coming soon',
        title: 'Invites',
        body: 'Bring someone into a single note without handing over the whole repo, with owner, editor, and viewer roles deciding what they can do.',
      },
    ],
  },

  download: {
    heading: 'Download',
    body: 'Available in English, Spanish, and Simplified Chinese.',
    cta: 'Download Myelin Notes',
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
    ] satisfies Platform[],
    otherPlatforms: 'Also available for',
    mobileBadge: 'Same notes on your phone and tablet, not a cut-down viewer',
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

## Can I import from Obsidian or GoodNotes?

Yes, both. A Notion importer is on the roadmap.

## Does it work offline?

Fully. Editing, full-text and semantic search, handwriting recognition, audio transcription, PDF annotation, and export all run on your own machine, so the app behaves identically with the network off. Only GitHub sync and live collaboration need a connection, and both are optional.

## What about iPhone, iPad, and Android?

Myelin Notes is native on all three, with the same notes, the same canvas, and the same sync as the desktop apps. Stylus input works wherever the hardware does: Apple Pencil on iPad, an S Pen or active stylus on Android, and pen tablets on desktop.
`,
  },

  /** Top-bar nav. Deliberately shorter than the footer's list. */
  header: {
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'License', href: siteLinks.license },
    ],
  },

  footer: {
    tagline: 'Handwriting, typing, and PDFs. One note.',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'GitHub', href: siteLinks.github },
      { label: 'Roadmap', href: siteLinks.roadmap },
      { label: 'License', href: siteLinks.license },
    ],
    download: 'Download Myelin',
  },
};

/**
 * `download.faqMarkdown` as question/answer pairs. The canvas renders that
 * string as a page frame; the static page needs headings and paragraphs, and
 * the page needs it a third time as FAQ structured data. One source, three
 * renderings, so they cannot drift.
 */
export const faqs = copy.download.faqMarkdown
  .split('\n## ')
  .slice(1)
  .map((block) => {
    const [question, ...answer] = block.split('\n');
    return { question: question.trim(), answer: answer.join(' ').trim() };
  });
