/**
 * Single pipeline for Google-hosted text-tool fonts: one TTF fetch feeds both
 * the DOM display path (registered via the FontFace API) and PDF export
 * (embedded via the request's `fontsB64` table). Display could render woff2,
 * but krilla can only embed TTF/OTF, so everything standardizes on the TTF
 * the css2 API serves to non-browser User-Agents — the platform fetch runs
 * outside the webview, so the UA is ours to set. Fetched faces persist in the
 * artifact cache, so previously-used fonts display and export offline.
 */

import { Logger } from '@myelin/shared/logger';
import { bytesToBase64 } from './pdf-export/contract';
import { getPlatform } from './platform';

const logger = new Logger('GoogleFonts');

/** Families shipped with the app's CSS (`@font-face` in foundations.css). */
const LOCAL_DISPLAY_FAMILIES = new Set(['hanken grotesk', 'newsreader']);

/**
 * Families whose bundled export font IS the display font (see
 * `src-tauri/src/pdf_export/fonts.rs`) — the sans/serif/mono mapping is
 * already exact for these, so embedding would only bloat the PDF.
 */
const EXPORT_BUNDLED_FAMILIES = new Set([
  'hanken grotesk',
  'newsreader',
  'jetbrains mono',
]);

/** Generic CSS families — nothing to fetch, and css2 rejects them with 400. */
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-monospace',
]);

/** In-flight/settled fetches by normalized family. Failures are not cached. */
const bytesCache = new Map<string, Promise<Uint8Array | null>>();
const registeredFaces = new Set<string>();

function normalize(family: string): string {
  return family.trim().toLowerCase();
}

/**
 * TTF bytes for a family at regular weight, or `null` when the fetch fails.
 * Failures aren't cached, so a later call retries (e.g. back online).
 */
export function fetchFontTtf(family: string): Promise<Uint8Array | null> {
  const key = normalize(family);
  if (!key || GENERIC_FAMILIES.has(key)) {
    return Promise.resolve(null);
  }
  let pending = bytesCache.get(key);
  if (!pending) {
    pending = loadTtf(family).catch((error) => {
      logger.warn('Failed to load font', { family, error });
      return null;
    });
    bytesCache.set(key, pending);
    pending.then((result) => {
      if (result === null) {
        bytesCache.delete(key);
      }
    });
  }
  return pending;
}

/**
 * Make a Google-hosted family renderable in the DOM (canvas text boxes, font
 * picker previews). Fire-and-forget; no-op for families the app ships locally.
 */
export function ensureDisplayFont(family: string): void {
  const key = normalize(family);
  if (
    !key ||
    GENERIC_FAMILIES.has(key) ||
    LOCAL_DISPLAY_FAMILIES.has(key) ||
    registeredFaces.has(key)
  ) {
    return;
  }
  // Registration is attempted once per session per family — callers run per
  // frame (TextElement.syncDOM), so a failure must NOT re-arm here or an
  // offline session retries the fetch every frame. Export calls still retry
  // (fetchFontTtf doesn't cache failures).
  registeredFaces.add(key);
  fetchFontTtf(family).then((bytes) => {
    if (!bytes) {
      return;
    }
    try {
      // Throws synchronously on unparseable bytes (e.g. an HTML error body
      // served with 200); without the catch that's an unhandled rejection.
      document.fonts.add(new FontFace(family, bytes));
    } catch (error) {
      logger.warn('Failed to register font face', { family, error });
    }
  });
}

/**
 * Base64 TTF for PDF export, or `null` when the family needs no embedding or
 * the fetch fails (callers fall back to the bundled `familyToKey` mapping).
 */
export function fetchFontTtfBase64(family: string): Promise<string | null> {
  if (EXPORT_BUNDLED_FAMILIES.has(normalize(family))) {
    return Promise.resolve(null);
  }
  return fetchFontTtf(family).then((bytes) =>
    bytes ? bytesToBase64(bytes) : null,
  );
}

async function loadTtf(family: string): Promise<Uint8Array | null> {
  const platform = getPlatform();
  const cachePath = `fonts/${normalize(family).replace(/\s+/g, '-')}-400.ttf`;

  const cachedUrl = await platform.artifactCache.getUrl(cachePath);
  if (cachedUrl) {
    const cached = await fetch(cachedUrl);
    if (cached.ok) {
      return new Uint8Array(await cached.arrayBuffer());
    }
  }

  const bytes = await fetchFromGoogle(family);
  if (bytes) {
    try {
      await platform.artifactCache.write(cachePath, new Blob([bytes]));
    } catch (error) {
      logger.warn('Failed to cache font', { family, error });
    }
  }
  return bytes;
}

async function fetchFromGoogle(family: string): Promise<Uint8Array | null> {
  const platform = getPlatform();
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400`;
  const cssResponse = await platform.fetch(cssUrl, {
    headers: { 'User-Agent': 'myelin' },
  });
  if (!cssResponse.ok) {
    return null;
  }
  const css = await cssResponse.text();
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
  if (!match) {
    return null;
  }
  const fontResponse = await platform.fetch(match[1]);
  if (!fontResponse.ok) {
    return null;
  }
  return new Uint8Array(await fontResponse.arrayBuffer());
}
