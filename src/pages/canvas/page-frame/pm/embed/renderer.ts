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
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return '';
  }
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

function buildOEmbedMedia(meta: OEmbedMeta): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pm-embed-rich-media';

  const iframe = document.createElement('iframe');
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-popups allow-presentation',
  );
  iframe.setAttribute('loading', 'lazy');
  iframe.srcdoc = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}body>iframe,body>embed,body>video,body>object{width:100%!important;height:100%!important;border:0;display:block;max-width:100%;max-height:100%}body>img{max-width:100%;height:auto;display:block}</style>${meta.html ?? ''}`;
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
  const favicon = faviconFor(url);
  if (favicon) {
    const fav = document.createElement('img');
    fav.src = favicon;
    fav.className = 'pm-embed-rich-favicon';
    fav.loading = 'lazy';
    header.appendChild(fav);
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
  const favicon = faviconFor(url);
  if (favicon) {
    const fav = document.createElement('img');
    fav.src = favicon;
    fav.className = 'pm-embed-link-favicon';
    metaRow.appendChild(fav);
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

export function renderEmbedHost(
  url: string,
  alt: string | null,
  hint: EmbedHint,
): EmbedHost {
  const host = document.createElement('div');
  host.className = 'pm-embed-host';
  host.contentEditable = 'false';

  let cancelled = false;
  const swap = (next: HTMLElement): void => {
    clear(host);
    host.appendChild(next);
  };

  if (!url) {
    return { dom: host, destroy: () => undefined };
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
  fetchEmbed(url).then((meta) => {
    if (cancelled) {
      return;
    }
    swap(renderResolved(meta, url));
  });

  return {
    dom: host,
    destroy: () => {
      cancelled = true;
    },
  };
}
