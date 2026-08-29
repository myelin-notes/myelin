import { describe, expect, it } from 'vitest';
import { decodeText } from './decode';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function utf16le(text: string, bom: boolean): Uint8Array {
  const out: number[] = bom ? [0xff, 0xfe] : [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    out.push(code & 0xff, code >> 8);
  }
  return new Uint8Array(out);
}

describe('decodeText', () => {
  it('decodes plain ASCII as utf-8', () => {
    expect(decodeText(new TextEncoder().encode('a,b\n1,2'))).toEqual({
      text: 'a,b\n1,2',
      encoding: 'utf-8',
    });
  });

  it('strips a utf-8 BOM', () => {
    const withBom = bytes(0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62);
    expect(decodeText(withBom)).toEqual({ text: 'a,b', encoding: 'utf-8' });
  });

  it('decodes utf-16le via its BOM', () => {
    expect(decodeText(utf16le('café,x', true))).toEqual({
      text: 'café,x',
      encoding: 'utf-16le',
    });
  });

  it('decodes utf-16be via its BOM', () => {
    const src = utf16le('a,b', false);
    const out = [0xfe, 0xff];
    for (let i = 0; i < src.length; i += 2) {
      out.push(src[i + 1], src[i]);
    }
    expect(decodeText(new Uint8Array(out))).toEqual({
      text: 'a,b',
      encoding: 'utf-16be',
    });
  });

  it('keeps valid multibyte utf-8 without a BOM', () => {
    expect(decodeText(new TextEncoder().encode('café'))).toEqual({
      text: 'café',
      encoding: 'utf-8',
    });
  });

  it('falls back to windows-1252 for bytes that are not valid utf-8', () => {
    // 0xE9 alone is `é` in windows-1252 but an invalid utf-8 lead byte.
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9))).toEqual({
      text: 'café',
      encoding: 'windows-1252',
    });
  });

  it('handles empty input', () => {
    expect(decodeText(new Uint8Array())).toEqual({
      text: '',
      encoding: 'utf-8',
    });
  });
});
