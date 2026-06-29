/**
 * Map a computed font style to a use-case key (`sans`/`serif`/`mono`) the Rust renderer
 * resolves to a bundled font. Keying by use case rather than font name means swapping
 * the actual fonts doesn't ripple through this contract.
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
  if (/newsreader|georgia|serif/.test(f) && !/sans-serif/.test(f)) {
    return 'serif';
  }
  return 'sans';
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
