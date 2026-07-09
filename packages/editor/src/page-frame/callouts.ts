export interface ParsedCalloutMarker {
  label: string;
  markerFrom: number;
  markerTo: number;
  titleFrom: number;
  titleTo: number;
  type: string;
}

const CALLOUT_MARKER_RE = /^\[!([A-Za-z][A-Za-z0-9_-]*)\][+-]?/;

function titleForType(type: string): string {
  return type
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export function parseCalloutMarker(text: string): ParsedCalloutMarker | null {
  const markerMatch = text.match(CALLOUT_MARKER_RE);
  if (!markerMatch) {
    return null;
  }

  const type = markerMatch[1].toLowerCase();
  let titleFrom = markerMatch[0].length;
  while (text[titleFrom] === ' ' || text[titleFrom] === '\t') {
    titleFrom++;
  }

  const lineEnd = text.indexOf('\n', titleFrom);
  const titleLineTo = lineEnd === -1 ? text.length : lineEnd;
  let titleTo = titleLineTo;
  while (titleTo > titleFrom && /[ \t]/.test(text[titleTo - 1])) {
    titleTo--;
  }

  return {
    label: titleForType(type),
    markerFrom: 0,
    markerTo: markerMatch[0].length,
    titleFrom,
    titleTo,
    type,
  };
}
