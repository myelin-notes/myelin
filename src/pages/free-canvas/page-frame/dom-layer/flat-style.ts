const UNITLESS = new Set([
  'lineHeight',
  'opacity',
  'zIndex',
  'fontWeight',
  'flex',
  'order',
  'flexGrow',
  'flexShrink',
  'columnCount',
  'orphans',
  'widows',
]);

export function flatStyle(style: React.CSSProperties): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value === 'number' && !UNITLESS.has(key)) {
      result[key] = `${value}px`;
    } else {
      result[key] = String(value);
    }
  }
  return result;
}
