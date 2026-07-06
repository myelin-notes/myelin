import { getPlatform } from '@/platform';
import { matchProvider } from './oembed-providers';
import { parseOg } from './og-parse';

export interface OEmbedMeta {
  kind: 'oembed';
  providerName: string;
  type: string | null;
  title: string | null;
  authorName: string | null;
  html: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface LinkMeta {
  kind: 'link';
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

/** A URL that resolves directly to an image/video (by Content-Type), even
 * though its path has no recognizable file extension. */
export interface MediaMeta {
  kind: 'media';
  mediaKind: 'image' | 'video';
  url: string;
}

export type EmbedMeta = OEmbedMeta | LinkMeta | MediaMeta;

const MAX_CACHE_ENTRIES = 200;
const cache = new Map<string, Promise<EmbedMeta>>();

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function fetchOEmbed(
  providerName: string,
  endpoint: string,
): Promise<OEmbedMeta> {
  const res = await getPlatform().fetch(endpoint, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`oEmbed ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    kind: 'oembed',
    providerName,
    type: asString(data.type),
    title: asString(data.title),
    authorName: asString(data.author_name),
    html: asString(data.html),
    thumbnailUrl: asString(data.thumbnail_url),
    width: asNumber(data.width),
    height: asNumber(data.height),
  };
}

function mediaKindFromContentType(
  contentType: string | null,
): MediaMeta['mediaKind'] | null {
  const value = contentType?.toLowerCase() ?? '';
  if (value.startsWith('image/')) {
    return 'image';
  }
  if (value.startsWith('video/')) {
    return 'video';
  }
  return null;
}

async function fetchLink(url: string): Promise<EmbedMeta> {
  const res = await getPlatform().fetch(url, {
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml,image/*,video/*' },
  });
  if (!res.ok) {
    throw new Error(`fetch ${res.status}`);
  }

  // A URL that serves an image/video directly (no extension in the path, e.g.
  // a CDN link) is rendered as media rather than scraped for OG tags.
  const mediaKind = mediaKindFromContentType(res.headers.get('content-type'));
  if (mediaKind) {
    return { kind: 'media', mediaKind, url };
  }

  const html = await res.text();
  const og = parseOg(html);
  return {
    kind: 'link',
    title: og.title,
    description: og.description,
    image: og.image,
    siteName: og.siteName,
  };
}

async function fetchInner(url: string): Promise<EmbedMeta> {
  const provider = matchProvider(url);
  if (provider) {
    try {
      return await fetchOEmbed(provider.name, provider.endpoint(url));
    } catch {
      // fall through to OG scrape
    }
  }
  return fetchLink(url);
}

function touch(url: string, p: Promise<EmbedMeta>): void {
  cache.delete(url);
  cache.set(url, p);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

export function fetchEmbed(url: string): Promise<EmbedMeta> {
  const existing = cache.get(url);
  if (existing) {
    touch(url, existing);
    return existing;
  }
  const p = fetchInner(url);
  touch(url, p);
  p.catch(() => {
    if (cache.get(url) === p) {
      cache.delete(url);
    }
  });
  return p;
}
