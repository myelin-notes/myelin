import {
  type EmbedMeta,
  fetchEmbed,
  type LinkMeta,
  type OEmbedMeta,
} from './fetcher';
import { type EmbedHint, resolveSyncKind } from './url-detect';

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function faviconFor(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/favicon.ico`;
  } catch {
    return '';
  }
}

function buildFavicon(url: string, className: string): HTMLImageElement | null {
  const src = faviconFor(url);
  if (!src) {
    return null;
  }
  const fav = document.createElement('img');
  fav.src = src;
  fav.className = className;
  fav.loading = 'lazy';
  fav.onerror = () => {
    fav.remove();
  };
  return fav;
}

function clear(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function buildImage(url: string, alt: string | null): HTMLElement {
  const img = document.createElement('img');
  img.src = url;
  if (alt) {
    img.alt = alt;
  }
  img.loading = 'lazy';
  img.className = 'pm-embed pm-embed-image';
  return img;
}

function buildVideo(url: string): HTMLElement {
  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.preload = 'metadata';
  video.className = 'pm-embed pm-embed-video';
  return video;
}

const VIDEO_TYPES = new Set(['video', 'photo']);
const DEFAULT_RICH_HEIGHT = 480;

const IFRAME_PASSTHROUGH_ATTRS = ['allowfullscreen', 'referrerpolicy', 'title'];

const PROVIDER_IFRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms';

const ALLOWED_IFRAME_FEATURES = new Set([
  'accelerometer',
  'autoplay',
  'clipboard-write',
  'encrypted-media',
  'fullscreen',
  'gyroscope',
  'picture-in-picture',
  'web-share',
]);

function sanitizeAllow(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const tokens = value
    .split(';')
    .map((part) => part.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
    .filter((feature) => ALLOWED_IFRAME_FEATURES.has(feature));
  return tokens.length > 0 ? tokens.join('; ') : null;
}

function extractProviderIframe(html: string): HTMLIFrameElement | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const source = doc.querySelector('iframe');
  const src = source?.getAttribute('src');
  if (!src || !/^https:\/\//i.test(src)) {
    return null;
  }
  const iframe = document.createElement('iframe');
  iframe.setAttribute('src', src);
  iframe.setAttribute('sandbox', PROVIDER_IFRAME_SANDBOX);
  const allow = sanitizeAllow(source?.getAttribute('allow') ?? null);
  if (allow) {
    iframe.setAttribute('allow', allow);
  }
  for (const attr of IFRAME_PASSTHROUGH_ATTRS) {
    const value = source?.getAttribute(attr);
    if (value !== null && value !== undefined) {
      iframe.setAttribute(attr, value);
    }
  }
  return iframe;
}

function buildOEmbedMedia(meta: OEmbedMeta): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pm-embed-rich-media';

  const providerIframe = meta.html ? extractProviderIframe(meta.html) : null;
  const iframe = providerIframe ?? document.createElement('iframe');
  if (!providerIframe) {
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-popups allow-presentation',
    );
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}body>iframe,body>embed,body>video,body>object{width:100%!important;height:100%!important;border:0;display:block;max-width:100%;max-height:100%}body>img{max-width:100%;height:auto;display:block}</style>${meta.html ?? ''}`;
  }
  iframe.setAttribute('loading', 'lazy');
  iframe.className = 'pm-embed-rich-iframe';

  const hasRatio = meta.width && meta.height;
  const isVideoLike = meta.type ? VIDEO_TYPES.has(meta.type) : hasRatio;

  if (hasRatio) {
    wrap.style.aspectRatio = `${meta.width} / ${meta.height}`;
  } else if (isVideoLike) {
    wrap.style.aspectRatio = '16 / 9';
  } else {
    wrap.style.height = `${DEFAULT_RICH_HEIGHT}px`;
  }

  wrap.appendChild(iframe);
  return wrap;
}

function buildOEmbed(meta: OEmbedMeta, url: string): HTMLElement {
  if (!meta.html) {
    return buildLinkCard(
      {
        kind: 'link',
        title: meta.title,
        description: meta.authorName,
        image: meta.thumbnailUrl,
        siteName: meta.providerName,
      },
      url,
    );
  }

  const card = document.createElement('div');
  card.className = 'pm-embed pm-embed-rich';
  card.setAttribute('data-provider', meta.providerName);

  const header = document.createElement('div');
  header.className = 'pm-embed-rich-header';
  const headerFav = buildFavicon(url, 'pm-embed-rich-favicon');
  if (headerFav) {
    header.appendChild(headerFav);
  }
  const provider = document.createElement('span');
  provider.className = 'pm-embed-rich-provider';
  provider.textContent = meta.providerName || hostnameOf(url);
  header.appendChild(provider);
  card.appendChild(header);

  if (meta.title) {
    const titleLink = document.createElement('a');
    titleLink.href = url;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.className = 'pm-embed-rich-title';
    titleLink.textContent = meta.title;
    card.appendChild(titleLink);
  }

  if (meta.authorName) {
    const author = document.createElement('div');
    author.className = 'pm-embed-rich-author';
    author.textContent = meta.authorName;
    card.appendChild(author);
  }

  card.appendChild(buildOEmbedMedia(meta));
  return card;
}

function buildLinkCard(meta: LinkMeta, url: string): HTMLElement {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.className = 'pm-embed pm-embed-link';

  if (meta.image) {
    const thumb = document.createElement('img');
    thumb.src = meta.image;
    thumb.loading = 'lazy';
    thumb.className = 'pm-embed-link-thumb';
    anchor.appendChild(thumb);
  }

  const body = document.createElement('div');
  body.className = 'pm-embed-link-body';

  const titleEl = document.createElement('div');
  titleEl.className = 'pm-embed-link-title';
  titleEl.textContent = meta.title || url;
  body.appendChild(titleEl);

  if (meta.description) {
    const desc = document.createElement('div');
    desc.className = 'pm-embed-link-desc';
    desc.textContent = meta.description;
    body.appendChild(desc);
  }

  const metaRow = document.createElement('div');
  metaRow.className = 'pm-embed-link-meta';
  const metaFav = buildFavicon(url, 'pm-embed-link-favicon');
  if (metaFav) {
    metaRow.appendChild(metaFav);
  }
  const site = document.createElement('span');
  site.textContent = meta.siteName || hostnameOf(url);
  metaRow.appendChild(site);
  body.appendChild(metaRow);

  anchor.appendChild(body);
  return anchor;
}

function buildSkeleton(url: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pm-embed pm-embed-skeleton';
  wrap.textContent = url;
  return wrap;
}

function renderResolved(meta: EmbedMeta, url: string): HTMLElement {
  if (meta.kind === 'oembed') {
    return buildOEmbed(meta, url);
  }
  return buildLinkCard(meta, url);
}

export interface EmbedHost {
  dom: HTMLElement;
  destroy: () => void;
}

export interface ResolvedMedia {
  url: string;
  kind: 'image' | 'video';
  revoke: () => void;
}

/**
 * Resolve a `/`-rooted library path to a renderable object URL, or `null` if
 * it doesn't point at an existing image/video.
 */
export type ResolveMediaSrc = (path: string) => Promise<ResolvedMedia | null>;

function isLibraryPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

export function renderEmbedHost(
  url: string,
  alt: string | null,
  hint: EmbedHint,
  resolveMedia?: ResolveMediaSrc,
): EmbedHost {
  const host = document.createElement('div');
  host.className = 'pm-embed-host pm-page-capped';
  host.contentEditable = 'false';

  let cancelled = false;
  const swap = (next: HTMLElement): void => {
    clear(host);
    host.appendChild(next);
  };

  if (!url) {
    return { dom: host, destroy: () => undefined };
  }

  if (resolveMedia && isLibraryPath(url)) {
    swap(buildSkeleton(url));
    let revoke: (() => void) | null = null;
    resolveMedia(url)
      .then((media) => {
        if (cancelled) {
          media?.revoke();
          return;
        }
        if (!media) {
          // Leave the skeleton showing the raw path so a broken/missing
          // reference is visible rather than silently empty.
          return;
        }
        revoke = media.revoke;
        swap(
          media.kind === 'video'
            ? buildVideo(media.url)
            : buildImage(media.url, alt),
        );
      })
      .catch(() => {
        // Leave the skeleton on failure.
      });

    return {
      dom: host,
      destroy: () => {
        cancelled = true;
        revoke?.();
      },
    };
  }

  const syncKind = resolveSyncKind(url, hint);
  if (syncKind === 'image') {
    swap(buildImage(url, alt));
    return { dom: host, destroy: () => undefined };
  }
  if (syncKind === 'video') {
    swap(buildVideo(url));
    return { dom: host, destroy: () => undefined };
  }

  swap(buildSkeleton(url));
  fetchEmbed(url)
    .then((meta) => {
      if (cancelled) {
        return;
      }
      swap(renderResolved(meta, url));
    })
    .catch(() => {
      if (cancelled) {
        return;
      }
      swap(
        buildLinkCard(
          {
            kind: 'link',
            title: null,
            description: null,
            image: null,
            siteName: null,
          },
          url,
        ),
      );
    });

  return {
    dom: host,
    destroy: () => {
      cancelled = true;
    },
  };
}
