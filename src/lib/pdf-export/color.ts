/** Parse a CSS color string into an 8-bit RGB triple + alpha (0..1). */

import type { Rgb } from './contract';

export interface ParsedColor {
  rgb: Rgb;
  opacity: number;
}

const BLACK: ParsedColor = { rgb: [0, 0, 0], opacity: 1 };

export function parseCssColor(css: string): ParsedColor {
  const s = css.trim().toLowerCase();

  if (s.startsWith('#')) {
    return parseHex(s.slice(1));
  }

  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean);
    const r = clamp255(Number.parseFloat(parts[0]));
    const g = clamp255(Number.parseFloat(parts[1]));
    const b = clamp255(Number.parseFloat(parts[2]));
    const a = parts[3] !== undefined ? clamp01(Number.parseFloat(parts[3])) : 1;
    return { rgb: [r, g, b], opacity: a };
  }

  return BLACK;
}

function parseHex(hex: string): ParsedColor {
  if (hex.length === 3 || hex.length === 4) {
    const r = dup(hex[0]);
    const g = dup(hex[1]);
    const b = dup(hex[2]);
    const a = hex.length === 4 ? dup(hex[3]) / 255 : 1;
    return { rgb: [r, g, b], opacity: a };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = byte(hex.slice(0, 2));
    const g = byte(hex.slice(2, 4));
    const b = byte(hex.slice(4, 6));
    const a = hex.length === 8 ? byte(hex.slice(6, 8)) / 255 : 1;
    return { rgb: [r, g, b], opacity: a };
  }
  return BLACK;
}

function dup(c: string): number {
  return byte(c + c);
}

function byte(h: string): number {
  return clamp255(Number.parseInt(h, 16));
}

function clamp255(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.max(0, Math.min(1, n));
}
