import { describe, expect, it } from 'vitest';
import { type SearchField, searchItems } from './index';

interface SearchFixture {
  id: string;
  title: string;
  description: string;
  tags: string[];
  kind: 'command' | 'note';
}

const fields: SearchField<SearchFixture>[] = [
  { name: 'title', weight: 4, getValue: (item) => item.title },
  { name: 'tags', weight: 3, getValue: (item) => item.tags },
  {
    name: 'description',
    weight: 1,
    getValue: (item) => item.description,
  },
];

const items: SearchFixture[] = [
  {
    id: 'create-note',
    title: 'Create note',
    description: 'Start a new canvas',
    tags: ['new', 'canvas'],
    kind: 'command',
  },
  {
    id: 'import-markdown',
    title: 'Import Markdown',
    description: 'Create a canvas from a file',
    tags: ['md'],
    kind: 'command',
  },
  {
    id: 'research-plan',
    title: 'Field work plan',
    description: 'Notes from the lab',
    tags: ['research', 'biology'],
    kind: 'note',
  },
];

describe('searchItems', () => {
  it('returns all items in source order for an empty query', () => {
    const results = searchItems(items, '', {
      fields,
      getId: (item) => item.id,
    });

    expect(results.map((result) => result.item.id)).toEqual([
      'create-note',
      'import-markdown',
      'research-plan',
    ]);
  });

  it('searches fields, metadata arrays, prefixes, and typos', () => {
    const tagResults = searchItems(items, 'resear', {
      fields,
      getId: (item) => item.id,
    });
    const typoResults = searchItems(items, 'neww', {
      fields,
      getId: (item) => item.id,
    });

    expect(tagResults.map((result) => result.item.id)).toEqual([
      'research-plan',
    ]);
    expect(typoResults.map((result) => result.item.id)).toEqual([
      'create-note',
    ]);
  });

  it('ranks stronger field matches ahead of weaker field matches', () => {
    const results = searchItems(items, 'create', {
      fields,
      getId: (item) => item.id,
    });

    expect(results.map((result) => result.item.id)).toEqual([
      'create-note',
      'import-markdown',
    ]);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('supports document-level ranking boosts', () => {
    const results = searchItems(
      [
        { id: 'older', title: 'Canvas notes' },
        { id: 'newer', title: 'Canvas notes' },
      ],
      'canvas',
      {
        fields: [{ name: 'title', getValue: (item) => item.title }],
        getId: (item) => item.id,
        rank: (item) => (item.id === 'newer' ? 2 : 1),
      },
    );

    expect(results.map((result) => result.item.id)).toEqual(['newer', 'older']);
  });

  it('supports filters and limits', () => {
    const results = searchItems(items, 'canvas', {
      fields,
      filter: (item) => item.kind === 'command',
      getId: (item) => item.id,
      limit: 1,
    });

    expect(results.map((result) => result.item.id)).toEqual(['create-note']);
  });
});
