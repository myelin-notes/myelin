import { DEFAULT_LOCALE, type Locale, localizePath } from '@/lib/locale';
import en from './en';
import es from './es';
import fr from './fr';
import type { Platform } from './links';
import zhHans from './zh-hans';

// Re-exported so build-time callers can take everything from this one barrel.
// Client-side code must import them from `./links` instead: this module pulls
// in every locale's catalog.
export {
  isComingSoon,
  type Platform,
  type PlatformKey,
  siteLinks,
} from './links';

/** Landing page sections that carry a kicker label, in page order. */
export const SCENE_IDS = [
  'ink',
  'pages',
  'audio-search',
  'linked',
  'sync',
  'local-first',
  'import',
  'download',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/** Every link the header or footer can point at. */
export type LinkId = 'features' | 'privacy' | 'support';

/**
 * The header and footer carry the same links. The set itself is the same in
 * every language; only the labels translate.
 */
export const navLinks: LinkId[] = ['features', 'support', 'privacy'];

const hrefs: Record<LinkId, string> = {
  features: '/features',
  privacy: '/privacy',
  support: '/support',
};

/**
 * Published in English only, so their href carries no locale prefix and every
 * locale links to the same page.
 */
const englishOnly: LinkId[] = ['privacy', 'support'];

export function linkHref(id: LinkId, locale: Locale): string {
  return englishOnly.includes(id) ? hrefs[id] : localizePath(hrefs[id], locale);
}

/** Sections of the features page, in page order. */
export const FEATURE_SECTION_IDS = [
  'handwriting',
  'pdfs',
  'pages',
  'canvas',
  'agents',
  'connect',
  'more',
] as const;

export type FeatureSectionId = (typeof FEATURE_SECTION_IDS)[number];

/** Features-page cards that play a clip. */
export type FeatureClipId =
  | 'shapes'
  | 'toolWheel'
  | 'ruler'
  | 'rotate'
  | 'pdfQuote'
  | 'pdfAnchor'
  | 'slash'
  | 'imageAnchor'
  | 'canvasStyle'
  | 'flags'
  | 'agents';

interface FeatureSection {
  /** The kicker, and the section's jump link at the top of the page. */
  label: string;
  heading: string;
  lede: string;
  details?: string[];
}

interface FeatureNote {
  title: string;
  body: string;
}

interface SyncTier {
  badge: string;
  /** Drives the badge colour; `badge` is translated so cannot be matched on. */
  live?: boolean;
  title: string;
  body: string;
}

/** Apps the site advertises importing from, keyed for icon lookup. */
export type ImportSourceId = 'goodnotes' | 'onenote' | 'obsidian' | 'notion';

/** One app the importer can pull a library out of. */
interface ImportSource {
  /** Picks the brand mark; independent of the translated `label`. */
  id: ImportSourceId;
  /**
   * The whole phrase, not a name a caller prefixes: word order differs by
   * language (Chinese wraps the app name, 从 X 导入), so each locale writes
   * its own.
   */
  label: string;
  detail: string;
}

/**
 * Every word the site says, in one locale. `en.ts` is the reference; adding a
 * key here breaks `es.ts`, `fr.ts` and `zh-hans.ts` until they are translated too.
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
    /** Substring of `headline` that gets the ink underline. */
    headlineMark: string;
    subheadline: string;
    trustLine: string;
    ctaPrimary: string;
    /** Links to the try-it canvas. */
    ctaSecondary: string;
  };

  /** Page title and meta description of the try-it canvas. */
  tryIt: {
    title: string;
    description: string;
    /** Top-bar badge marking the canvas as a limited web version. */
    badge: string;
    /** The badge's tooltip: what the app has that the web version lacks. */
    limited: string;
  };

  ink: {
    pdfHeading: string;
    pdfBody: string;
  };

  pages: {
    heading: string;
    body: string;
  };

  audioSearch: {
    heading: string;
    audioBody: string;
    searchBody: string;
  };

  linked: { heading: string; body: string };

  importing: {
    heading: string;
    body: string;
    /**
     * Ordered as the app's own import picker lists them, then Notion, which
     * has no picker row of its own: its Markdown and CSV export goes through
     * the Files importer. Deliberately only the apps someone migrates FROM:
     * the picker's "Files" and "Workspace JSON" rows are real importers but
     * not reasons to switch, so they stay in the FAQ answer instead.
     */
    sources: ImportSource[];
  };

  localFirst: { heading: string; lede: string; bullets: string[] };

  sync: {
    heading: string;
    kicker: string;
    tiers: SyncTier[];
  };

  download: {
    body: string;
    cta: string;
    platforms: Platform[];
    /** Heads the row of platforms that have no build yet. */
    comingSoon: string;
    mobileBadge: string;
    faqTitle: string;
    /** `## ` headings become the FAQ entries; see `getFaqs`. */
    faqMarkdown: string;
  };

  /** The features page, which goes past what the landing page shows. */
  features: {
    meta: { title: string; description: string };
    eyebrow: string;
    headline: string;
    subheadline: string;
    /** Labels the row of jump links to each section. */
    jumpNav: string;
    sections: Record<FeatureSectionId, FeatureSection>;
    clips: Record<FeatureClipId, FeatureNote & { alt: string }>;
    /** Text-only cards in the `connect` section. */
    notes: FeatureNote[];
    closing: { heading: string; body: string };
  };

  linkLabels: Record<LinkId, string>;

  footer: {
    nav: string;
    tagline: string;
    platforms: string;
  };

  shots: {
    hero: string;
    pdf: string;
    pageFrame: string;
    audio: string;
    graph: string;
  };

  canvas: {
    addCustomColor: string;
  };
}

const catalogs: Record<Locale, SiteCopy> = {
  en,
  es,
  fr,
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
 * `download.faqMarkdown` as question/answer pairs, for the FAQ section and its
 * structured data. One source, so the two cannot drift.
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
