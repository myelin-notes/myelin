import { DEFAULT_LOCALE, type Locale } from '@/lib/locale';
import en from './en';
import es from './es';
import { type Platform, siteLinks } from './links';
import zhHans from './zh-hans';

// Re-exported so build-time callers can take everything from this one barrel.
// Client-side code must import them from `./links` instead: this module pulls
// in every locale's catalog.
export { type Platform, type PlatformKey, siteLinks } from './links';

/**
 * Scenes of the scrollytelling canvas, in order. Layout (world coordinates)
 * lives in `src/canvas/scenes.ts` and the labels live in the locale files; this
 * is the shared vocabulary both index into.
 */
export const SCENE_IDS = [
  'hero',
  'ink',
  'pages',
  'audio-search',
  'linked',
  'sync',
  'local-first',
  'download',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/** Every link the header or footer can point at. */
export type LinkId = 'privacy' | 'license' | 'github' | 'roadmap';

/** The nav sets themselves are the same everywhere; only the labels translate. */
export const headerLinks: LinkId[] = ['privacy', 'license'];
export const footerLinks: LinkId[] = [
  'privacy',
  'license',
  'github',
  'roadmap',
];

/**
 * The privacy policy is published in English only, so its href carries no
 * locale prefix and every locale links to the same page.
 */
export function linkHref(id: LinkId): string {
  return id === 'privacy' ? '/privacy' : siteLinks[id];
}

export function isExternalLink(id: LinkId): boolean {
  return id !== 'privacy';
}

interface SearchResultMock {
  kind: 'page' | 'ink' | 'audio';
  title: string;
  snippet: string;
}

interface SyncTier {
  /** Drives the badge color, so it does not depend on the translated word. */
  shipped: boolean;
  badge: string;
  title: string;
  body: string;
}

/** World-space geometry for one hand-drawn ink decoration. */
interface Decoration {
  dx: number;
  dy: number;
  width: number;
}

/**
 * Every word the site says, in one locale. `en.ts` is the reference; adding a
 * key here breaks `es.ts` and `zh-hans.ts` until they are translated too.
 *
 * Site style: no em dashes.
 */
export interface SiteCopy {
  meta: { title: string; description: string };

  topbar: { nav: string; download: string; language: string };

  sceneLabels: Record<SceneId, string>;
  faqKicker: string;

  hero: {
    eyebrow: string;
    headline: string;
    subheadline: string;
    trustLine: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };

  ink: {
    annotation: string;
    recognized: string;
    pdfHeading: string;
    pdfBody: string;
    pdfAnnotation: string;
  };

  pages: {
    heading: string;
    body: string;
    annotation: string;
    pageTitle: string;
    pageMarkdown: string;
  };

  audioSearch: {
    heading: string;
    audioBody: string;
    searchBody: string;
    audioMock: {
      title: string;
      duration: string;
      transcriptLabel: string;
      transcript: string;
      /** Must appear verbatim inside `transcript`: it is highlighted in place. */
      match: string;
    };
    searchMock: { query: string; results: SearchResultMock[] };
  };

  linked: { heading: string; body: string };

  localFirst: { heading: string; lede: string; bullets: string[] };

  sync: {
    heading: string;
    kicker: string;
    cursorYou: string;
    cursorPeer: string;
    sharedNote: string;
    tiers: SyncTier[];
  };

  download: {
    heading: string;
    body: string;
    cta: string;
    autoUpdates: string;
    platforms: Platform[];
    otherPlatforms: string;
    mobileBadge: string;
    faqTitle: string;
    /** `## ` headings become the FAQ entries; see `getFaqs`. */
    faqMarkdown: string;
  };

  linkLabels: Record<LinkId, string>;

  footer: {
    nav: string;
    tagline: string;
    download: string;
    platforms: string;
  };

  shots: {
    library: string;
    pdf: string;
    pageFrame: string;
    audio: string;
    graph: string;
  };

  canvas: {
    rail: {
      label: string;
      previous: string;
      next: string;
      scrollHint: string;
    };
    palette: {
      label: string;
      placeholder: string;
      empty: string;
      groupGoTo: string;
      groupGetIt: string;
      download: string;
    };
    addCustomColor: string;
  };

  decorations: {
    heroUnderline: Decoration;
    localFirstHighlight: Decoration;
    syncUnderline: Decoration;
  };
}

const catalogs: Record<Locale, SiteCopy> = {
  en,
  es,
  'zh-hans': zhHans,
};

export function getCopy(locale: Locale = DEFAULT_LOCALE): SiteCopy {
  return catalogs[locale];
}

export interface Faq {
  question: string;
  answer: string;
}

/**
 * `download.faqMarkdown` as question/answer pairs. The canvas renders that
 * string as a page frame; the static page needs headings and paragraphs, and
 * the page needs it a third time as FAQ structured data. One source, three
 * renderings, so they cannot drift.
 */
export function getFaqs(locale: Locale = DEFAULT_LOCALE): Faq[] {
  return getCopy(locale)
    .download.faqMarkdown.split('\n## ')
    .slice(1)
    .map((block) => {
      const [question, ...answer] = block.split('\n');
      return { question: question.trim(), answer: answer.join(' ').trim() };
    });
}
