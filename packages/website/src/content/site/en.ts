import type { SiteCopy } from './index';

/**
 * Site style: no em dashes.
 */
const en: SiteCopy = {
  meta: {
    title: 'Myelin Notes | Cross-Platform Note-Taking App',
    description:
      'Combine handwriting, typed notes, and PDFs in Myelin Notes for Mac, Windows, and Linux. Works offline, with no account. Free for personal use.',
  },

  topbar: {
    nav: 'Site',
    download: 'Download',
    language: 'Language',
    beta: 'Beta',
    betaNote: 'Myelin Notes is in beta, and pricing plans may change.',
  },

  /** Section kickers on the landing page. */
  sceneLabels: {
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
    // Names the product in the hero itself, so it reads as a standalone chunk,
    // which is how crawlers and answer engines lift it.
    eyebrow: 'Cross-platform note-taking app for Mac, Windows, and Linux',
    headline: 'Myelin Notes: handwriting, typing, and PDFs. One note.',
    headlineMark: 'One note.',
    subheadline:
      'Myelin Notes is a cross-platform note-taking app for Mac, Windows, and Linux. Combine handwriting, typed notes, and PDFs on one canvas. Works offline and is free for personal use.',
    trustLine:
      'Free for personal use · No account required · Your notes are never paywalled',
    ctaPrimary: 'Download',
    ctaSecondary: 'Try it in your browser',
  },

  tryIt: {
    title: 'Try Myelin Notes in your browser',
    description:
      'A Myelin canvas to draw, type, and write on, right in your browser, saved in this browser. Download the app for every feature.',
    badge: 'Limited web preview',
    limited:
      'This is a limited web preview. The app also has a notes library, search, audio recording, PDF export, and sync.',
  },

  ink: {
    pdfHeading: 'Write directly on your PDFs.',
    pdfBody:
      'Drop a PDF onto the canvas and mark it up in the same ink as everything else: circle an equation, highlight a line, scribble in the margins. When you are done, export the annotated PDF back out.',
  },

  pages: {
    heading: 'Real documents, right on the canvas.',
    body: 'Page frames are full rich-text documents: Markdown shortcuts, headings, lists and checkboxes, tables, math, and code blocks, which Pro lets you run.',
  },

  audioSearch: {
    heading: 'Record it. Transcribe it. Find it on the canvas.',
    audioBody:
      'Record lectures or meetings on the canvas. A bundled Whisper base model transcribes them on-device, so you can find words in the transcript without sending audio away. Pro adds more accurate models.',
    searchBody:
      'Search your library by note title, tags, and saved text or audio transcripts. Find matches within an open canvas, too.',
  },

  linked: {
    heading: 'Your notes, connected.',
    body: '[[Note links]], backlinks, and hover preview cards keep related ideas one hop away. The command palette jumps you anywhere, and per-file version history restores any earlier state of a note.',
  },

  importing: {
    heading: 'Bring your old notes with you.',
    body: 'Import your notes from other apps',
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
    heading: 'It all lives on your machine.',
    lede: 'No cloud in the middle. Your notes are ordinary files on your own disk, and Myelin works completely offline.',
    bullets: [
      'Your notes are plain files on your disk, in an open, conflict-free format (Yjs). Nothing is ever locked in.',
      'Everything works fully offline, with no account and no server in the middle.',
      'Your notes stay on your own machine.',
      'With Pro, bring your own AI: models connect through a local MCP server, never a cloud we chose for you.',
      'Import from Obsidian or GoodNotes, export to PDF, images, or JSON, and read every line of source on GitHub.',
    ],
  },

  sync: {
    heading: 'Sync and collaborate, no server in the middle.',
    kicker:
      'Real-time editing normally means a server holding your notes. Myelin connects the devices directly instead.',
    tiers: [
      {
        badge: 'Today',
        live: true,
        title: 'Live collaboration',
        body: 'Two devices with the same note open find each other automatically, then edit in step over an encrypted QUIC connection straight between them (iroh).',
      },
      {
        badge: 'Today',
        live: true,
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
    body: 'Available in English, Spanish, French, and Simplified Chinese.',
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
    ],
    comingSoon: 'Coming soon',
    mobileBadge:
      'iPhone, iPad, and Android are on the way: the same notes, not a cut-down viewer',
    faqTitle: 'FAQ',
    faqMarkdown: `# FAQ

## Is it really free?

Yes. The free version is free for personal use, with no time limit and nearly every feature. Myelin Pro is a one-time purchase of $49.99, or $29.99 for students, that adds AI agents over MCP, runnable code, and higher limits. Your notes are never paywalled.

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

Fully. Editing, audio transcription, PDF annotation, and export all run on your own machine, so the app behaves identically with the network off. Only GitHub sync and live collaboration need a connection, and both are optional.

## What about iPhone, iPad, and Android?

Coming soon. Today Myelin Notes runs on Mac, Windows, and Linux. The mobile apps are in development, and they are native builds rather than a cut-down viewer: the same notes, the same canvas, and the same sync as the desktop apps, with Apple Pencil on iPad and an S Pen or active stylus on Android.
`,
  },

  features: {
    meta: {
      title: 'Features | Myelin Notes',
      description:
        'Everything Myelin Notes can do: shape snapping, a ruler and pen presets for handwriting, PDF quotes and anchored ink, pages with Mermaid diagrams, AI agents over local MCP, and more.',
    },
    eyebrow: 'Features',
    headline: 'Everything Myelin Notes can do.',
    subheadline:
      'The home page shows the big picture. This is the detail: the tools for handwriting, PDFs, pages, and the canvas, and how they fit together.',
    jumpNav: 'Sections',
    sections: {
      handwriting: {
        label: 'Handwriting',
        heading: 'Ink that feels like a pen, with a few tricks paper lacks.',
        lede: 'Write with a stylus, a finger, or a mouse. Myelin straightens what you want straight and leaves your handwriting yours.',
        details: [
          'Pressure-sensitive pens, with adjustable stabilization for steadier lines',
          'Palm rejection, and a Pen or Touch mode for what your fingers do',
          'The pen button switches to the eraser, right away or once the pen lifts',
          'A stroke eraser or a precise one that erases only what it touches',
          'Rectangle or lasso selection, then move, copy, lock, or reorder',
          'Custom colors you save once and reuse, and typed text in your choice of font',
        ],
      },
      pdfs: {
        label: 'PDFs',
        heading: 'PDFs you work in, not just look at.',
        lede: 'Annotate, quote, and rearrange PDFs on the same canvas as the rest of your notes, then export the result.',
        details: [
          'Export the annotated PDF when you are done',
          'Jump to any page with the page navigator',
          'Lay a PDF out as Pages, or side by side as Columns',
          'Flag a PDF page to come back to it',
          'Find words inside PDFs with canvas search',
        ],
      },
      pages: {
        label: 'Pages',
        heading: 'Pages that do more than hold text.',
        lede: 'Page frames are rich-text documents on the canvas. Type / for anything you want to insert, or just write Markdown.',
        details: [
          'Markdown shortcuts for headings, lists, quotes, and formatting',
          'To-do checklists, callouts, and tables',
          'Math blocks, and code blocks you can run with Pro',
          '[[Note links]] with hover previews, updated when you rename a note',
          'Embedded images, videos, YouTube, and link cards',
          'Pages, Columns, or Continuous layout',
        ],
      },
      canvas: {
        label: 'Canvas',
        heading: 'An infinite canvas that stays easy to find your way around.',
        lede: 'Put pages, PDFs, images, audio, and ink anywhere, and get back to any spot in a keystroke.',
        details: [
          'Images you can crop, rotate, lock, and anchor to a page',
          'Take a photo with your camera and drop it straight in',
          'LaTeX blocks for equations anywhere on the canvas',
          'Light or dark theme, or follow the system',
          'Rebind keyboard shortcuts in Settings',
        ],
      },
      sync: {
        label: 'Live sync',
        heading: 'Write together, with no server holding your notes.',
        lede: 'Open a note on two devices and they connect to each other directly. What you write on one shows up on the other as you write it.',
        details: [
          'Devices with the same note open find each other on their own',
          'Edits travel over an end-to-end encrypted QUIC connection (iroh)',
          'Both devices need access to the same GitHub sync repo',
          'No Myelin account needed',
        ],
      },
      agents: {
        label: 'AI agents',
        heading: 'Bring your own AI, on your own machine.',
        lede: 'Myelin has no built-in chatbot. It runs a local MCP server instead, so the AI app you already use can read your notes and, when you allow it, write to them. AI agents are part of Myelin Pro.',
        details: [
          'The server listens only on 127.0.0.1, on a port you choose',
          'Copy the install prompt from Settings to connect your agent',
          'Agents can read notes, links, pages, PDFs, images, handwriting, and canvas screenshots',
          'Writing stays off until you turn on direct MCP writes in Settings',
          'With writes on, agents can create notes, pages, LaTeX, and ink, and edit tags',
        ],
      },
      connect: {
        label: 'Find & connect',
        heading: 'Everything you write stays findable.',
        lede: 'Audio, search, and links tie your notes together, so last month’s idea is a few keystrokes away.',
      },
      more: {
        label: 'And more',
        heading: 'Your files, your sync, your language.',
        lede: 'The foundations, in one list.',
        details: [
          'Notes are plain files on your disk, in an open format (Yjs)',
          'Works fully offline, with no account',
          'Sync across devices through a GitHub repo you control',
          'Import from Goodnotes, OneNote, Obsidian, Notion, Markdown, and PDFs',
          'Export to PDF, Markdown, an Obsidian vault, or workspace JSON',
          'In English, Spanish, French, and Simplified Chinese',
        ],
      },
    },
    clips: {
      shapes: {
        title: 'Shape snapping',
        body: 'Draw a rough rectangle, ellipse, triangle, or line and hold the pen still. It snaps to a clean shape.',
        alt: 'Rough shapes drawn with the pen snap to clean ones when the pen holds still',
      },
      toolWheel: {
        title: 'Tool wheel and pen presets',
        body: 'Right-click to open a wheel of your tools and saved pens right where you are writing. No trip to the toolbar.',
        alt: 'The tool wheel opens at the cursor and a saved pen preset is picked from it',
      },
      ruler: {
        title: 'Ruler',
        body: 'Turn on the Ruler, drag its knob to any angle, and draw along its edge for a dead-straight line.',
        alt: 'The ruler is turned to 30 degrees and a wobbly stroke along its edge lands perfectly straight',
      },
      lasso: {
        title: 'Tidy up after you write',
        body: 'Lasso a patch of handwriting to drag it into place, or pull a corner to resize it. Select a single drawing to turn it with the handle above it.',
        alt: 'Handwriting is lassoed, dragged under its heading and shrunk from a corner, then an arrow is turned to point at it',
      },
      pdfQuote: {
        title: 'Quote from PDFs',
        body: 'Select text in a PDF, choose Quote, and tap a page to drop it in, with a link back to where it came from.',
        alt: 'A sentence selected in a PDF is quoted into a note as a blockquote that links back to the PDF',
      },
      pdfAnchor: {
        title: 'Notes that stay on the page',
        body: 'What you write on a PDF page is attached to that page. Move the PDF or change its layout, and your notes stay in the same spot on the page. Anchor to page pins images and shapes the same way.',
        alt: 'A formula on page 2 of a PDF is circled and annotated, then the PDF switches to Columns and the ink moves with its page',
      },
      slash: {
        title: 'Insert anything with /',
        body: 'Type / in a page for headings, tables, callouts, math, and code. A mermaid code block draws a diagram, and Embed turns a link into a video or link card.',
        alt: 'The / menu inserts a code block whose mermaid flowchart renders as a diagram, then Embed turns a YouTube link into a video card',
      },
      imageAnchor: {
        title: 'Images that flow with your text',
        body: 'Anchor an image to a page and the text makes room for it. Type above it and the image moves down with the words.',
        alt: 'A photo on a page is anchored, the text makes room for it, and typing above carries it down',
      },
      canvasStyle: {
        title: 'A style for every canvas',
        body: 'Pick a grid, dots, lines, or, with Pro, your own image, and set the colors. Each canvas can have its own, and Settings sets the default.',
        alt: 'The Canvas style panel switches the background to lines and picks a warm paper color',
      },
      flags: {
        title: 'Flags to come back to',
        body: 'Drop a flag with the Flag tool (B) and pick a type like To-do or Review, or make your own. Jump between the flags on a canvas, or open Flags to filter them across all your notes.',
        alt: 'A heading gets a To-do flag and a PDF page a Review flag, the flag list jumps to the PDF, then the Flags page filters to Review flags across notes',
      },
      liveCollab: {
        title: 'Live collaboration',
        body: 'Ink appears on the other screen stroke by stroke as you draw, and typing appears letter by letter, in both directions.',
        alt: 'Ink drawn on a Mac appears on Ada’s PC as it is written, then a to-do Ada types appears on the Mac letter by letter',
      },
      agents: {
        title: 'Your AI app, talking to Myelin',
        body: 'The chat window here stands in for whichever AI app you use: it is not part of Myelin. Over MCP on your machine, it reads your handwriting and adds a typed summary page to the canvas.',
        alt: 'A separate AI app reads handwritten notes in Myelin over MCP and adds a typed summary page beside them',
      },
    },
    notes: [
      {
        title: 'Audio recording',
        body: 'Record a lecture or meeting straight onto the canvas, or import a voice memo.',
      },
      {
        title: 'On-device transcription',
        body: 'A bundled Whisper model transcribes on your machine. Tap any line’s timestamp to play from there.',
      },
      {
        title: 'Search',
        body: 'Search your library by title, tags, and saved text or transcripts, and find any word on the open canvas.',
      },
      {
        title: 'Links and backlinks',
        body: 'Link notes with [[double brackets]], see every backlink, and hover a link to preview the note.',
      },
      {
        title: 'Graph view',
        body: 'See how your notes link together, and open any of them from the graph.',
      },
      {
        title: 'Nested tags',
        body: 'Tag your notes, nest tags under each other, and filter the library by any of them.',
      },
      {
        title: 'Command palette',
        body: 'Open a note, create one, or open the graph without leaving the keyboard.',
      },
      {
        title: 'Version history',
        body: 'Every note keeps its earlier versions, and any of them restores in a click.',
      },
    ],
    closing: {
      heading: 'See it for yourself.',
      body: 'Free for personal use, with no account. Download the app, or try a canvas in your browser first.',
    },
  },

  pricing: {
    meta: {
      title: 'Pricing | Myelin Notes',
      description:
        'Myelin Notes is free for personal use. Myelin Pro is a one-time purchase of $49.99, or $29.99 for students, for AI agents over MCP, runnable code, and higher limits.',
    },
    eyebrow: 'Pricing',
    headline: 'Free to use. Pro when you want more.',
    subheadline:
      'The free version has nearly everything. Pro is a one-time purchase that unlocks the rest and supports Myelin’s development.',
    free: {
      name: 'Free',
      price: '$0',
      tagline: 'For personal use, with no time limit.',
      includesLabel: 'Includes',
      includes: [
        'Handwriting, PDFs, pages, and the infinite canvas',
        'Audio recording with on-device transcription',
        'GitHub sync and live collaboration',
        'Import, export, search, and links',
        'Up to 6 custom pen presets',
        '2 flag types',
      ],
      cta: 'Download',
    },
    pro: {
      name: 'Pro',
      price: '$49.99',
      priceNote: 'one-time purchase',
      tagline: 'Pay once. No subscription.',
      includesLabel: 'Everything in Free, plus',
      includes: [
        'AI agents over a local MCP server',
        'Run code blocks in your pages',
        'Unlimited flag types',
        'Unlimited custom pen presets',
        'Your own images as canvas backgrounds',
        'More accurate transcription models',
        'Support Myelin’s development',
      ],
      cta: 'Buy Pro',
      licenseNote:
        'You get a license key by email. It unlocks Pro on up to 3 of your devices.',
    },
    student: {
      name: 'Student',
      tagline: 'Everything in Pro, for students with a school email address.',
      price: '$29.99',
      note: 'Enter your school email address and we will send you a link to the student checkout.',
      emailLabel: 'School email',
      submit: 'Send link',
      sending: 'Sending…',
      sent: 'Check your inbox for the student checkout link.',
      notAcademic:
        'We do not recognise that as a school email address. Contact support if your school is missing.',
      failed: 'We could not send the link. Please try again.',
    },
    faqTitle: 'Pricing questions',
    faqs: [
      {
        question: 'How do I unlock Pro?',
        answer:
          'Buy Pro and you get a license key by email. Enter it in the Myelin app to unlock Pro on that device.',
      },
      {
        question: 'How many devices can I use it on?',
        answer: 'One license key unlocks Pro on up to 3 of your devices.',
      },
      {
        question: 'Is it a subscription?',
        answer: 'No. Pro is a one-time purchase.',
      },
      {
        question: 'How does student pricing work?',
        answer:
          'Enter your school email address on this page. If it belongs to a recognised school, we email you a link to buy Pro for $29.99. The link works for 24 hours.',
      },
      {
        question: 'What happens to my notes if I stay on Free?',
        answer:
          'Nothing. Your notes are plain files on your disk, and the free version opens all of them.',
      },
    ],
  },

  /** Labels for the shared link set; the hrefs live in `index.ts`. */
  linkLabels: {
    features: 'Features',
    pricing: 'Pricing',
    privacy: 'Privacy',
    support: 'Support',
  },

  footer: {
    nav: 'Footer',
    tagline: 'Handwriting, typing, and PDFs. One note.',
    platforms: 'Mac · Windows · Linux · iPhone, iPad, and Android coming soon',
  },

  /** Alt text for the static page's screenshots. */
  shots: {
    hero: 'A PDF and a typed page frame on one canvas, as a pen circles an equation, draws an arrow to the note, a line is typed in and "key result!" is handwritten',
    pdf: 'A PDF where a sentence is highlighted, a line underlined and "E = mc²!" written in the margin, then the annotated PDF is exported',
    pageFrame:
      'A page frame with a checklist and a TypeScript code block that runs and shows its output beside it',
    audio:
      'An audio recording placed on the canvas, recorded, transcribed, then found by searching "entropy"',
    graph:
      "The Myelin Notes graph view, showing a note's outgoing links and backlinks",
  },

  /** Chrome on the try-it canvas. */
  canvas: {
    addCustomColor: 'Add a custom color (hex, e.g. #3b82f6)',
  },
};

export default en;
