export interface OgMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const META_RE = /<meta\s+([^>]+?)\/?>/gi;
const ATTR_RE = /(\w[\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function decode(s: string | null): string | null {
  if (s == null) {
    return null;
  }
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function parseOg(html: string): OgMeta {
  const head = html.slice(0, Math.min(html.length, 200_000));
  const tags: Record<string, string> = {};
  META_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = META_RE.exec(head))) {
    const attrs = parseAttrs(m[1]);
    const key = (
      attrs.property ||
      attrs.name ||
      attrs.itemprop ||
      ''
    ).toLowerCase();
    if (!key || !attrs.content) {
      continue;
    }
    if (!(key in tags)) {
      tags[key] = attrs.content;
    }
  }
  const titleMatch = head.match(TITLE_RE);
  return {
    title: decode(
      tags['og:title'] || tags['twitter:title'] || titleMatch?.[1] || null,
    ),
    description: decode(
      tags['og:description'] ||
        tags['twitter:description'] ||
        tags.description ||
        null,
    ),
    image: decode(
      tags['og:image'] ||
        tags['twitter:image'] ||
        tags['twitter:image:src'] ||
        null,
    ),
    siteName: decode(tags['og:site_name'] || null),
  };
}
