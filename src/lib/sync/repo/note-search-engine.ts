import MiniSearch from 'minisearch';

export interface NoteSearchDocument {
  id: string;
  name: string;
  tags: string;
  kind: string;
  fileType: string;
  content: string;
}

export interface NoteSearchHit {
  id: string;
  score: number;
  matchedTerms: string[];
  contentSnippet: string | null;
}

const SNIPPET_RADIUS = 90;
// 120k distinct content terms made MiniSearch prefix expansion take 2.5s; a text scan took ~1ms.
const MAX_PREFIX_TERMS = 10_000;
const SEARCH_OPTIONS = {
  combineWith: 'AND' as const,
  fuzzy: (term: string) => (term.length >= 4 ? 0.2 : false),
  maxFuzzy: 2,
  prefix: true,
  weights: { fuzzy: 0.65, prefix: 0.9 },
};

export class NoteSearchEngine {
  private readonly documents = new Map<string, NoteSearchDocument>();
  private readonly index = new MiniSearch<NoteSearchDocument>({
    fields: ['name', 'tags', 'kind', 'fileType', 'content'],
    idField: 'id',
    searchOptions: {
      ...SEARCH_OPTIONS,
      boost: { name: 4, tags: 3, kind: 1, fileType: 1, content: 2 },
    },
  });
  private readonly metadataIndex = new MiniSearch<NoteSearchDocument>({
    fields: ['name', 'tags', 'kind', 'fileType'],
    idField: 'id',
    searchOptions: {
      ...SEARCH_OPTIONS,
      boost: { name: 4, tags: 3, kind: 1, fileType: 1 },
    },
  });

  upsert(document: NoteSearchDocument): void {
    const previous = this.documents.get(document.id);
    if (
      previous &&
      previous.name === document.name &&
      previous.tags === document.tags &&
      previous.kind === document.kind &&
      previous.fileType === document.fileType &&
      previous.content === document.content
    ) {
      return;
    }
    const metadataChanged =
      !previous ||
      previous.name !== document.name ||
      previous.tags !== document.tags ||
      previous.kind !== document.kind ||
      previous.fileType !== document.fileType;
    if (previous) {
      this.index.remove(previous);
      if (metadataChanged) {
        this.metadataIndex.remove(previous);
      }
    }
    this.documents.set(document.id, document);
    this.index.add(document);
    if (metadataChanged) {
      this.metadataIndex.add(document);
    }
  }

  remove(id: string): void {
    const previous = this.documents.get(id);
    if (previous) {
      this.index.remove(previous);
      this.metadataIndex.remove(previous);
      this.documents.delete(id);
    }
  }

  get(id: string): NoteSearchDocument | undefined {
    return this.documents.get(id);
  }

  ids(): IterableIterator<string> {
    return this.documents.keys();
  }

  search(query: string, limit?: number): NoteSearchHit[] {
    if (!query.trim()) {
      const documents = [...this.documents.values()];
      return (limit === undefined ? documents : documents.slice(0, limit)).map(
        ({ id }) => ({ id, score: 0, matchedTerms: [], contentSnippet: null }),
      );
    }
    if (this.index.termCount > MAX_PREFIX_TERMS) {
      return this.searchLargeIndex(query, limit);
    }
    const results = this.index.search(query.trim());
    return (limit === undefined ? results : results.slice(0, limit)).map(
      (result) => {
        const content = this.documents.get(String(result.id))?.content ?? '';
        const contentTerms = Object.entries(result.match)
          .filter(([, fields]) => fields.includes('content'))
          .map(([term]) => term.toLowerCase());
        return {
          id: String(result.id),
          score: result.score,
          matchedTerms: result.terms,
          contentSnippet: contentSnippet(content, contentTerms),
        };
      },
    );
  }

  private searchLargeIndex(query: string, limit?: number): NoteSearchHit[] {
    const terms = query
      .toLowerCase()
      .split(/[\p{Z}\p{P}\p{S}]+/u)
      .filter(Boolean);
    if (!terms.length) {
      return [];
    }
    const matches = terms.map(
      (term) =>
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'iu',
        ),
    );
    const metadataHits = this.metadataIndex
      .search(query.trim())
      .map((result) => ({
        id: String(result.id),
        score: result.score,
        matchedTerms: result.terms,
        contentSnippet: null as string | null,
      }));
    const byId = new Map(metadataHits.map((hit) => [hit.id, hit]));
    const hits: NoteSearchHit[] = [];
    for (const document of this.documents.values()) {
      const name = document.name.toLowerCase();
      const tags = document.tags.toLowerCase();
      const content = document.content.toLowerCase();
      let score = 0;
      const contentTerms: string[] = [];
      for (let i = 0; i < terms.length; i++) {
        const match = matches[i];
        const contentTerm = findContentTerm(content, terms[i], match);
        if (contentTerm) {
          contentTerms.push(contentTerm);
        }
        if (match.test(name)) {
          score += 4;
        } else if (match.test(tags)) {
          score += 3;
        } else if (contentTerm) {
          score += 2;
        } else if (match.test(document.kind) || match.test(document.fileType)) {
          score += 1;
        } else {
          score = 0;
          break;
        }
      }
      if (score) {
        const snippet = contentSnippet(document.content, contentTerms);
        const metadataHit = byId.get(document.id);
        if (metadataHit) {
          metadataHit.contentSnippet = snippet;
        } else {
          hits.push({
            id: document.id,
            score,
            matchedTerms: terms,
            contentSnippet: snippet,
          });
        }
      }
    }
    hits.sort((a, b) => b.score - a.score);
    const results = [...metadataHits, ...hits];
    return limit === undefined ? results : results.slice(0, limit);
  }
}

function findContentTerm(
  content: string,
  term: string,
  prefix: RegExp,
): string | null {
  if (prefix.test(content)) {
    return term;
  }
  if (term.length < 4) {
    return null;
  }
  const distance = Math.min(2, Math.floor(term.length * 0.2));
  if (!distance) {
    return null;
  }
  for (const [word] of content.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (
      Math.abs(word.length - term.length) <= distance &&
      withinDistance(word, term, distance)
    ) {
      return word;
    }
  }
  return null;
}

function withinDistance(a: string, b: string, max: number): boolean {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let smallest = current[0];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      smallest = Math.min(smallest, current[j]);
    }
    if (smallest > max) {
      return false;
    }
    previous = current;
  }
  return previous[b.length] <= max;
}

function contentSnippet(content: string, terms: string[]): string | null {
  if (!content || terms.length === 0) {
    return null;
  }
  const lower = content.toLowerCase();
  const at = Math.min(
    ...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0),
  );
  if (!Number.isFinite(at)) {
    return null;
  }
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(content.length, at + SNIPPET_RADIUS);
  const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${snippet}${end < content.length ? '...' : ''}`;
}
