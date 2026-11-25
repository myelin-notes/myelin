import { describe, expect, it } from 'vitest';
import type { FolderNameRule, VFSFolderNode } from '@/lib/sync';
import {
  cleanName,
  renderNamePattern,
  resolveNamePattern,
} from './name-pattern';

function folder(id: string, nameRule?: FolderNameRule): VFSFolderNode {
  return {
    id,
    name: id,
    type: 'folder',
    parentId: null,
    tags: [],
    createdAt: 1,
    modifiedAt: 1,
    nameRule,
  };
}

describe('renderNamePattern', () => {
  const date = new Date(2024, 6, 10, 15, 30);

  it('renders tokens in the given locale and leaves unknown tokens literal', () => {
    expect(renderNamePattern('{date} - {weekday} {oops}', date, 'en')).toBe(
      'July 10, 2024 - Wednesday {oops}',
    );
    expect(renderNamePattern('{date:short}', date, 'en')).toBe('7/10/24');
    expect(renderNamePattern('{date:full} {time}', date, 'en')).toBe(
      'Wednesday, July 10, 2024 3:30 PM',
    );
    expect(renderNamePattern('{date} {weekday}', date, 'fr')).toBe(
      '10 juillet 2024 mercredi',
    );
  });
});

describe('cleanName', () => {
  it('drops trailing whitespace and dangling separators', () => {
    expect(cleanName('July 10, 2024 - ')).toBe('July 10, 2024');
    expect(cleanName('  Notes —:| ')).toBe('Notes');
    expect(cleanName(' - ')).toBe('');
    expect(cleanName('Q3 - Plan')).toBe('Q3 - Plan');
  });
});

describe('resolveNamePattern', () => {
  const custom = (pattern: string): FolderNameRule => ({
    mode: 'custom',
    pattern,
  });

  it('walks inherit up to the nearest custom rule', () => {
    expect(
      resolveNamePattern([
        folder('a', custom('{date}')),
        folder('b', { mode: 'inherit' }),
        folder('c', { mode: 'inherit' }),
      ]),
    ).toBe('{date}');
  });

  it('uses the folder own rule over ancestors', () => {
    expect(
      resolveNamePattern([folder('a', custom('x')), folder('b', custom('y'))]),
    ).toBe('y');
  });

  it('has no rule when unset or inheriting all the way to the root', () => {
    expect(
      resolveNamePattern([folder('a', custom('x')), folder('b')]),
    ).toBeNull();
    expect(
      resolveNamePattern([folder('a'), folder('b', { mode: 'inherit' })]),
    ).toBeNull();
    expect(resolveNamePattern([])).toBeNull();
  });
});
