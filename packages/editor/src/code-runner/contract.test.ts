import { describe, expect, it } from 'vitest';
import { parseDisplayPayload } from './contract';

const wrap = (json: string) => `\u001b]myelin-display;${json}\u0007`;

describe('parseDisplayPayload', () => {
  it('reads a well-formed payload', () => {
    expect(
      parseDisplayPayload(wrap('{"mime":"image/png","data":"AAA"}')),
    ).toEqual({ mime: 'image/png', data: 'AAA' });
  });

  it('ignores ordinary output', () => {
    expect(parseDisplayPayload('hello')).toBeNull();
    expect(parseDisplayPayload('')).toBeNull();
  });

  it('treats an unknown mime as text', () => {
    expect(
      parseDisplayPayload(wrap('{"mime":"text/csv","data":"a,b"}')),
    ).toBeNull();
  });

  // A program that prints the sentinel itself must not be able to make output
  // disappear -- an unparseable payload falls back to rendering as text.
  it('treats a malformed payload as text', () => {
    expect(parseDisplayPayload(wrap('not json'))).toBeNull();
    expect(parseDisplayPayload(wrap('{"mime":"text/html"}'))).toBeNull();
    expect(
      parseDisplayPayload(wrap('{"mime":"text/html","data":7}')),
    ).toBeNull();
  });

  it('requires both delimiters', () => {
    expect(
      parseDisplayPayload(
        '\u001b]myelin-display;{"mime":"text/html","data":"x"}',
      ),
    ).toBeNull();
  });
});
