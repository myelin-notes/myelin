import { describe, expect, it } from 'vitest';
import { wrapTextLines } from './wrap';

// One unit per character keeps expected breaks readable and independent of any font.
const measure = (text: string) => text.length;

describe('wrapTextLines', () => {
  it('wraps between words without leaving trailing spaces', () => {
    expect(wrapTextLines('alpha beta gamma', 10, measure)).toEqual([
      'alpha beta',
      'gamma',
    ]);
  });

  it('keeps hard line breaks and blank lines', () => {
    expect(wrapTextLines('one\n\ntwo', 10, measure)).toEqual([
      'one',
      '',
      'two',
    ]);
  });

  it('breaks a word wider than the box', () => {
    expect(wrapTextLines('abcdefgh', 3, measure)).toEqual(['abc', 'def', 'gh']);
  });

  it('never loses text when one character is wider than the box', () => {
    expect(wrapTextLines('ab', 0, measure).join('')).toBe('ab');
  });
});
