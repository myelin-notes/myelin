import {
  splitNoteLinkTargetFrame,
  unescapeNoteLinkSegment,
} from './link-syntax';

export interface ParsedNoteLinkTarget {
  isPath: boolean;
  path: string;
  noteName: string;
  pageFrameName: string | null;
}

export function parseNoteLinkTarget(
  target: string,
): ParsedNoteLinkTarget | null {
  const { noteTarget, frame } = splitNoteLinkTargetFrame(target);

  const segments = noteTarget
    .split('/')
    .map((segment) => unescapeNoteLinkSegment(segment).trim());
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const noteName = segments[segments.length - 1];
  return {
    isPath: segments.length > 1,
    path: segments.join('/'),
    noteName,
    pageFrameName:
      frame === null ? null : unescapeNoteLinkSegment(frame).trim() || null,
  };
}
