/**
 * Map a computed font style to the bundled font the Rust renderer embeds.
 * The webview loads Hanken Grotesk (sans/body) and Nyght Serif (serif/headings); code
 * uses a system monospace which we approximate with the bundled JetBrains Mono.
 */

import type { FontKey } from './contract';

export interface ResolvedFont {
  font: FontKey;
  weight: number;
  italic: boolean;
}

export function resolveFont(style: CSSStyleDeclaration): ResolvedFont {
  return {
    font: familyToKey(style.fontFamily),
    weight: parseWeight(style.fontWeight),
    italic: /italic|oblique/i.test(style.fontStyle),
  };
}

export function familyToKey(fontFamily: string): FontKey {
  const f = fontFamily.toLowerCase();
  if (/mono|consolas|menlo|cascadia|sfmono|courier/.test(f)) {
    return 'mono';
  }
  if (/nyght|georgia|serif/.test(f) && !/sans-serif/.test(f)) {
    return 'nyght';
  }
  return 'hanken';
}

function parseWeight(fontWeight: string): number {
  if (fontWeight === 'normal') {
    return 400;
  }
  if (fontWeight === 'bold') {
    return 700;
  }
  const n = Number.parseInt(fontWeight, 10);
  return Number.isFinite(n) ? n : 400;
}
