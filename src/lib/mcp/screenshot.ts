import { renderCanvasRegion } from '@myelin/editor/canvas-thumbnail';
import { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { createMediaPathResolver } from '@myelin/editor/page-frame/media-path/resolution';
import type { ReadableRepository, VFSNodeId } from '@/lib/sync';
import { loadMcpNote } from './read-model';
import type { McpScreenshot } from './types';

const DEFAULT_MAX_SIZE = 1200;
const MAX_MAX_SIZE = 2400;
/** Breathing room around auto-fitted content so nothing sits on the edge. */
const FIT_PADDING = 32;

export interface McpScreenshotRegion {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function clampScreenshotMaxSize(maxSize: number | undefined): number {
  if (maxSize === undefined) {
    return DEFAULT_MAX_SIZE;
  }
  return Math.max(64, Math.min(Math.trunc(maxSize), MAX_MAX_SIZE));
}

/**
 * Rasterize part of a canvas note to PNG without the note being open in the
 * editor: hydrate a `DrawableCanvas` from the stored doc against a detached
 * canvas element, replay the thumbnail draw pass, then tear it down.
 *
 * The detached canvas is never laid out, so nothing paints to screen and the
 * viewport is unused — `renderCanvasRegion` takes the world-space rect
 * directly.
 */
export async function renderMcpScreenshot(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  region: McpScreenshotRegion,
  maxSize: number,
): Promise<McpScreenshot> {
  const { ydoc } = await loadMcpNote(repository, noteId);
  const element = document.createElement('canvas');
  const canvas = new DrawableCanvas(
    element,
    ydoc,
    undefined,
    undefined,
    createMediaPathResolver(repository),
  );

  try {
    const content = canvas.contentBounds;
    if (isFitting(region) && content.width <= 0 && content.height <= 0) {
      throw new Error(
        `Note ${noteId} has no visible content to capture. read_note reports what is on the canvas.`,
      );
    }

    const capture = resolveCaptureRect(region, content);
    if (capture.width <= 0 || capture.height <= 0) {
      throw new Error(
        'Screenshot width and height must both be greater than zero.',
      );
    }

    const blob = await renderCanvasRegion(canvas.elements, capture, maxSize);
    return {
      noteId,
      region: {
        x: capture.x,
        y: capture.y,
        width: capture.width,
        height: capture.height,
      },
      mimeType: 'image/png',
      base64: await blobToBase64(blob),
    };
  } finally {
    canvas.destroy();
  }
}

/** True when no edge was pinned, i.e. the capture frames the whole note. */
function isFitting(region: McpScreenshotRegion): boolean {
  return (
    region.x === undefined &&
    region.y === undefined &&
    region.width === undefined &&
    region.height === undefined
  );
}

/**
 * Any of x/y/width/height may be omitted, in which case that edge falls back to
 * the note's content bounds — so no arguments at all fits the whole note.
 */
function resolveCaptureRect(
  region: McpScreenshotRegion,
  content: DOMRect,
): DOMRect {
  return new DOMRect(
    region.x ?? content.x - FIT_PADDING,
    region.y ?? content.y - FIT_PADDING,
    region.width ?? content.width + FIT_PADDING * 2,
    region.height ?? content.height + FIT_PADDING * 2,
  );
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked so a large PNG can't blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}
