import { describe, expect, it } from 'vitest';
import { parseCsv, toCsvTable } from './parse';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ignores a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles CRLF and bare CR', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps delimiters and newlines inside quotes', () => {
    expect(parseCsv('"a,b","c\nd",e')).toEqual([['a,b', 'c\nd', 'e']]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']]);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,,b\n,,')).toEqual([
      ['a', '', 'b'],
      ['', '', ''],
    ]);
  });

  it('reads a quoted empty field as a row', () => {
    expect(parseCsv('""')).toEqual([['']]);
  });

  it('treats a quote mid-field as a literal', () => {
    expect(parseCsv('ab"cd')).toEqual([['ab"cd']]);
  });

  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([['']]);
  });
});

describe('toCsvTable', () => {
  it('splits off the header and pads ragged rows', () => {
    expect(toCsvTable('a,b,c\n1,2\n3,4,5,6')).toEqual({
      header: ['a', 'b', 'c', ''],
      rows: [
        ['1', '2', '', ''],
        ['3', '4', '5', '6'],
      ],
      columnCount: 4,
    });
  });

  it('returns null when there are no rows', () => {
    expect(toCsvTable('')).toBeNull();
  });

  it('handles a header with no data rows', () => {
    expect(toCsvTable('a,b')).toEqual({
      header: ['a', 'b'],
      rows: [],
      columnCount: 2,
    });
  });
});
