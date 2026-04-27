export type MarkdownMediaKind = 'image' | 'video';

export interface ParsedMarkdownMediaEmbed {
  alt: string | null;
  height: number | null;
  kind: MarkdownMediaKind;
  src: string;
  title: string | null;
  width: number | null;
}

export interface ParsedNoteEmbed {
  fragment: string | null;
  height: number | null;
  noteId: string | null;
  target: string;
  title: string;
  width: number | null;
}

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);
const VIDEO_EXTENSIONS = new Set(['mkv', 'mov', 'mp4', 'ogv', 'webm']);
const UNSUPPORTED_WIKI_MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  '3gp',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'pdf',
  'wav',
]);

const MARKDOWN_MEDIA_RE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;
const NOTE_EMBED_RE = /^!\[\[([^\]]+)\]\]$/;
const SIZE_RE = /^(\d+)(?:x(\d+))?$/;

function parseSizeToken(
  token: string | undefined,
): { height: number | null; width: number | null } | null {
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  const match = trimmed.match(SIZE_RE);
  if (!match) {
    return null;
  }

  return {
    width: Number.parseInt(match[1], 10),
    height: match[2] ? Number.parseInt(match[2], 10) : null,
  };
}

function parseMarkdownMediaLabel(label: string): {
  alt: string | null;
  height: number | null;
  width: number | null;
} {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return { alt: null, width: null, height: null };
  }

  const parts = trimmed.split('|');
  const size = parseSizeToken(parts[parts.length - 1]);
  if (!size) {
    return { alt: trimmed, width: null, height: null };
  }

  const alt = parts.slice(0, -1).join('|').trim();
  return {
    alt: alt.length > 0 ? alt : null,
    width: size.width,
    height: size.height,
  };
}

function getDataUriMime(target: string): string | null {
  const match = target.match(/^data:([^;,]+)[;,]/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function getMarkdownMediaKind(target: string): MarkdownMediaKind | null {
  const dataUriMime = getDataUriMime(target);
  if (dataUriMime?.startsWith('image/')) {
    return 'image';
  }
  if (dataUriMime?.startsWith('video/')) {
    return 'video';
  }

  const trimmed = target.trim();
  const noHash = trimmed.split('#', 1)[0] ?? trimmed;
  const noQuery = noHash.split('?', 1)[0] ?? noHash;
  const lastSegment = noQuery.split('/').pop() ?? noQuery;
  const extension = lastSegment.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!extension) {
    return null;
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }
  return null;
}

function looksLikeUnsupportedWikiMediaTarget(target: string): boolean {
  const trimmed = target.trim();
  const noHash = trimmed.split('#', 1)[0] ?? trimmed;
  const lastSegment = noHash.split('/').pop() ?? noHash;
  const extension = lastSegment.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? UNSUPPORTED_WIKI_MEDIA_EXTENSIONS.has(extension) : false;
}

export function parseRawMarkdownMediaEmbed(
  source: string,
): ParsedMarkdownMediaEmbed | null {
  const match = source.trim().match(MARKDOWN_MEDIA_RE);
  if (!match) {
    return null;
  }

  const src = match[2] ?? '';
  const kind = getMarkdownMediaKind(src);
  if (!kind) {
    return null;
  }

  const label = parseMarkdownMediaLabel(match[1] ?? '');
  return {
    kind,
    src,
    alt: label.alt,
    width: label.width,
    height: label.height,
    title: match[3] ?? null,
  };
}

export function parseRawNoteEmbed(source: string): ParsedNoteEmbed | null {
  const match = source.trim().match(NOTE_EMBED_RE);
  if (!match) {
    return null;
  }

  const inner = (match[1] ?? '').trim();
  if (inner.length === 0) {
    return null;
  }

  const parts = inner.split('|');
  const size = parseSizeToken(parts[parts.length - 1]);
  const target = (size ? parts.slice(0, -1) : parts).join('|').trim();
  if (target.length === 0 || looksLikeUnsupportedWikiMediaTarget(target)) {
    return null;
  }

  const hashIndex = target.indexOf('#');
  const title = (hashIndex === -1 ? target : target.slice(0, hashIndex)).trim();
  if (title.length === 0) {
    return null;
  }

  return {
    target,
    title,
    fragment: hashIndex === -1 ? null : target.slice(hashIndex),
    noteId: null,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

function buildSizeSuffix(width: number | null, height: number | null): string {
  if (!width) {
    return '';
  }
  return height ? `|${width}x${height}` : `|${width}`;
}

export function serializeMarkdownMediaEmbed(
  embed: Pick<
    ParsedMarkdownMediaEmbed,
    'alt' | 'height' | 'src' | 'title' | 'width'
  >,
): string {
  const altText = embed.alt?.trim() ?? '';
  const sizeSuffix = buildSizeSuffix(embed.width, embed.height);
  const label = altText.length > 0 ? `${altText}${sizeSuffix}` : sizeSuffix;
  const titleSuffix =
    typeof embed.title === 'string' && embed.title.length > 0
      ? ` "${embed.title}"`
      : '';
  return `![${label}](${embed.src}${titleSuffix})`;
}

export function serializeNoteEmbed(
  embed: Pick<ParsedNoteEmbed, 'height' | 'target' | 'width'>,
): string {
  return `![[${embed.target}${buildSizeSuffix(embed.width, embed.height)}]]`;
}
