import type { TranscriptSegment } from '../../platform/types';

/** Parse the element's `transcriptSegments` Y.Map value, dropping anything malformed. */
export function toSegments(value: unknown): TranscriptSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const segments: TranscriptSegment[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { startSeconds, endSeconds, text } = entry as Record<string, unknown>;
    if (
      typeof startSeconds !== 'number' ||
      typeof endSeconds !== 'number' ||
      typeof text !== 'string'
    ) {
      continue;
    }
    const trimmed = text.trim();
    if (trimmed) {
      segments.push({ startSeconds, endSeconds, text: trimmed });
    }
  }
  return segments;
}

/** The flat transcript, as search and the note index consume it. */
export function segmentsToText(segments: readonly TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join(' ');
}

/** Index of the segment covering `seconds`, or -1. Segments are in playback order. */
export function activeSegmentIndex(
  segments: readonly TranscriptSegment[],
  seconds: number,
): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (seconds >= segments[i].startSeconds) {
      return seconds < segments[i].endSeconds ? i : -1;
    }
  }
  return -1;
}
