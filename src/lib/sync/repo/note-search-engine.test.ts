import { describe, expect, it } from 'vitest';
import {
  type NoteSearchDocument,
  NoteSearchEngine,
} from './note-search-engine';

const note = (
  id: string,
  name: string,
  content = '',
  tags = '',
): NoteSearchDocument => ({
  id,
  name,
  tags,
  kind: 'file',
  fileType: 'mcanvas',
  content,
});

describe('NoteSearchEngine', () => {
  it('searches titles, tags, and content with snippets and title priority', () => {
    const engine = new NoteSearchEngine();
    engine.upsert(
      note('body', 'Other', 'A long note about zebras in the field.'),
    );
    engine.upsert(note('title', 'Zebras', 'Nothing related.'));
    engine.upsert(note('tag', 'Third', '', 'zebras'));

    const results = engine.search('zebra');
    expect(results.map((hit) => hit.id)).toEqual(['title', 'tag', 'body']);
    expect(results.find((hit) => hit.id === 'body')?.contentSnippet).toContain(
      'zebras',
    );
    expect(
      results.find((hit) => hit.id === 'title')?.contentSnippet,
    ).toBeNull();
    expect(engine.search('zebrae').map((hit) => hit.id)).toContain('body');
  });

  it('replaces only changed documents and removes stale content', () => {
    const engine = new NoteSearchEngine();
    const original = note('one', 'Alpha', 'secret otter');
    engine.upsert(original);
    engine.upsert(original);
    engine.upsert(note('one', 'Beta', 'new fox'));

    expect(engine.search('secret')).toEqual([]);
    expect(engine.search('Alpha')).toEqual([]);
    expect(engine.search('fox')[0]?.id).toBe('one');
    expect(engine.search('Beta')[0]?.id).toBe('one');

    engine.remove('one');
    expect(engine.search('fox')).toEqual([]);
  });

  it('keeps broad content prefixes responsive in a large index', () => {
    const engine = new NoteSearchEngine();
    engine.upsert(
      note(
        'body',
        'Other',
        Array.from({ length: 10_001 }, (_, i) => `synthetic${i}`).join(' '),
      ),
    );
    engine.upsert(note('title', 'Synthetic overview'));

    expect(engine.search('synthetic').map((hit) => hit.id)).toEqual([
      'title',
      'body',
    ]);
    expect(engine.search('synthetc')[0]?.id).toBe('title');
    expect(engine.search('synthetc0').map((hit) => hit.id)).toContain('body');
    expect(
      engine.search('synthetc0').find((hit) => hit.id === 'body')
        ?.contentSnippet,
    ).toContain('synthetic0');
    expect(engine.search('synthetic9999')[0]?.id).toBe('body');
    expect(engine.search('synthetic', 1)).toHaveLength(1);
  });
});
