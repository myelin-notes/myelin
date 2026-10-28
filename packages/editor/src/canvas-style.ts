import type * as Y from 'yjs';
import { UserPrefs, type UserPrefsKey } from './user-prefs';
import { LOCAL_ORIGIN } from './ydoc-manager';

export type CanvasPattern = 'grid' | 'dots' | 'lines' | 'blank' | 'image';
export type CanvasColorMode = 'theme' | 'custom';

export interface CanvasBackgroundImage {
  /** PNG data URL. */
  src: string;
  /** Tile size in world units. */
  width: number;
  height: number;
}

export interface CanvasStyle {
  pattern: CanvasPattern;
  backgroundColorMode: CanvasColorMode;
  backgroundColor: string;
  patternColorMode: CanvasColorMode;
  patternColor: string;
  /** Kept while another pattern is picked, so switching back doesn't re-prompt. */
  image: CanvasBackgroundImage | null;
}

// Mapped onto the pre-existing global prefs so users keep their settings.
const PREF_KEYS = {
  pattern: 'canvasBackground',
  backgroundColorMode: 'canvasBackgroundColorMode',
  backgroundColor: 'canvasBackgroundColor',
  patternColorMode: 'canvasPatternColorMode',
  patternColor: 'canvasPatternColor',
  image: 'canvasBackgroundImage',
} as const satisfies Record<keyof CanvasStyle, UserPrefsKey>;
const FIELDS = Object.keys(PREF_KEYS) as (keyof CanvasStyle)[];

const IMAGE_MAX_PX = 512;
// The bg layer's overdraw grows with the tile (tile × MAX_ZOOM), so a peer-supplied size is capped.
const IMAGE_MAX_WORLD = IMAGE_MAX_PX / 2;
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

// A root map, not part of 'elements': the UndoManager only tracks 'elements', so style edits
// aren't undone by Cmd+Z.
function overrideMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('canvasStyle');
}

function isTileSize(value: unknown): boolean {
  return typeof value === 'number' && value > 0 && value <= IMAGE_MAX_WORLD;
}

// The image arrives from peers and synced files; anything else would let it fetch a remote URL.
function isValidImage(image: unknown): image is CanvasBackgroundImage {
  if (typeof image !== 'object' || image === null) {
    return false;
  }
  const { src, width, height } = image as Record<string, unknown>;
  return (
    typeof src === 'string' &&
    PNG_DATA_URL.test(src) &&
    isTileSize(width) &&
    isTileSize(height)
  );
}

export function getDefaultCanvasStyle(): CanvasStyle {
  const style: Partial<Record<keyof CanvasStyle, unknown>> = {};
  for (const field of FIELDS) {
    style[field] = UserPrefs.get(PREF_KEYS[field]);
  }
  return style as CanvasStyle;
}

/** `true` when the canvas has its own style instead of following the global default. */
export function hasCanvasStyleOverride(doc: Y.Doc): boolean {
  return overrideMap(doc).size > 0;
}

/** The style a canvas renders with; `null` reads the global default. */
export function getCanvasStyle(doc: Y.Doc | null): CanvasStyle {
  const style: CanvasStyle = {
    ...getDefaultCanvasStyle(),
    ...(doc ? (overrideMap(doc).toJSON() as Partial<CanvasStyle>) : null),
  };
  if (!isValidImage(style.image)) {
    style.image = null;
  }
  return style;
}

/** Writes to the canvas's own style, or to the global default when `doc` is `null`. */
export function setCanvasStyle(
  doc: Y.Doc | null,
  patch: Partial<CanvasStyle>,
): void {
  if (!doc) {
    for (const [field, value] of Object.entries(patch)) {
      UserPrefs.set(PREF_KEYS[field as keyof CanvasStyle], value as never);
    }
    return;
  }
  const map = overrideMap(doc);
  // The first edit snapshots the whole style, so later changes to the default don't leak in.
  const next = map.size > 0 ? patch : { ...getCanvasStyle(doc), ...patch };
  doc.transact(() => {
    for (const [field, value] of Object.entries(next)) {
      map.set(field, value);
    }
  }, LOCAL_ORIGIN);
}

export function clearCanvasStyle(doc: Y.Doc): void {
  doc.transact(() => overrideMap(doc).clear(), LOCAL_ORIGIN);
}

/** Calls `fn` on any change that can move `getCanvasStyle(doc)`. */
export function subscribeCanvasStyle(
  doc: Y.Doc | null,
  fn: () => void,
): () => void {
  const unsubs = FIELDS.map((field) =>
    UserPrefs.subscribe(PREF_KEYS[field], fn),
  );
  if (doc) {
    const map = overrideMap(doc);
    const observer = () => fn();
    map.observe(observer);
    unsubs.push(() => map.unobserve(observer));
  }
  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

export async function createBackgroundImage(
  blob: Blob,
): Promise<CanvasBackgroundImage> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(
    1,
    IMAGE_MAX_PX / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to get canvas context');
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Stored at 2x so the tile stays sharp on high-DPI screens at 100% zoom.
  return {
    src: canvas.toDataURL('image/png'),
    width: canvas.width / 2,
    height: canvas.height / 2,
  };
}
