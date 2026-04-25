import MiniSearch, {
  type SearchOptions as MiniSearchOptions,
  type SearchResult as MiniSearchResult,
} from 'minisearch';

export type SearchFieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly SearchFieldValue[];

export interface SearchField<T> {
  name: string;
  weight?: number;
  getValue: (item: T) => SearchFieldValue;
}

export interface SearchHit<T> {
  id: string;
  item: T;
  score: number;
  terms: string[];
  queryTerms: string[];
  match: Record<string, string[]>;
}

export interface SearchIndex<T> {
  search: (query: string, options?: SearchQueryOptions<T>) => SearchHit<T>[];
}

export interface SearchIndexOptions<T> {
  items: readonly T[];
  fields: readonly SearchField<T>[];
  getId: (item: T, index: number) => string;
  rank?: (item: T) => number;
  searchOptions?: MiniSearchOptions;
}

export interface SearchQueryOptions<T> {
  filter?: (item: T) => boolean;
  limit?: number;
  searchOptions?: MiniSearchOptions;
}

interface SearchDocument {
  id: string;
  [field: string]: string;
}

const DEFAULT_SEARCH_OPTIONS: MiniSearchOptions = {
  combineWith: 'AND',
  fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
  maxFuzzy: 2,
  prefix: true,
  weights: {
    fuzzy: 0.65,
    prefix: 0.9,
  },
};

export function createSearchIndex<T>({
  items,
  fields,
  getId,
  rank,
  searchOptions,
}: SearchIndexOptions<T>): SearchIndex<T> {
  const entries = items.map((item, index) => ({
    id: getId(item, index),
    item,
  }));
  const itemById = new Map<string, T>();
  const fieldNames = fields.map((field) => field.name);
  const boost = Object.fromEntries(
    fields.map((field) => [field.name, field.weight ?? 1]),
  );

  const documents = entries.map(({ id, item }) => {
    itemById.set(id, item);
    const document: SearchDocument = { id };
    for (const field of fields) {
      document[field.name] = stringifySearchField(field.getValue(item));
    }
    return document;
  });

  const index = new MiniSearch<SearchDocument>({
    fields: fieldNames,
    idField: 'id',
    searchOptions: {
      ...DEFAULT_SEARCH_OPTIONS,
      boost,
      ...searchOptions,
    },
  });
  index.addAll(documents);

  return {
    search(query, options = {}) {
      const trimmed = query.trim();
      const filteredEntries = options.filter
        ? entries.filter(({ item }) => options.filter?.(item) ?? true)
        : entries;

      if (!trimmed) {
        return limitHits(
          filteredEntries.map(({ id, item }) => ({
            id,
            item,
            score: 0,
            terms: [],
            queryTerms: [],
            match: {},
          })),
          options.limit,
        );
      }

      const results = index.search(trimmed, {
        ...options.searchOptions,
        filter: (result) => {
          const item = itemById.get(String(result.id));
          return item ? (options.filter?.(item) ?? true) : false;
        },
      });

      const hits = results.flatMap((result) => {
        const item = itemById.get(String(result.id));
        if (!item) {
          return [];
        }
        const score = result.score * (rank?.(item) ?? 1);
        return [toSearchHit(result, item, score)];
      });

      if (rank) {
        hits.sort((a, b) => b.score - a.score);
      }

      return limitHits(hits, options.limit);
    },
  };
}

export function searchItems<T>(
  items: readonly T[],
  query: string,
  options: Omit<SearchIndexOptions<T>, 'items'> & SearchQueryOptions<T>,
): SearchHit<T>[] {
  const {
    filter,
    limit,
    searchOptions: querySearchOptions,
    ...indexOptions
  } = options;
  const index = createSearchIndex({
    ...indexOptions,
    items,
  });
  return index.search(query, {
    filter,
    limit,
    searchOptions: querySearchOptions,
  });
}

function stringifySearchField(value: SearchFieldValue): string {
  if (Array.isArray(value)) {
    return value.map(stringifySearchField).filter(Boolean).join(' ');
  }
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function toSearchHit<T>(
  result: MiniSearchResult,
  item: T,
  score: number,
): SearchHit<T> {
  return {
    id: String(result.id),
    item,
    score,
    terms: result.terms,
    queryTerms: result.queryTerms,
    match: result.match,
  };
}

function limitHits<T>(hits: SearchHit<T>[], limit: number | undefined) {
  return limit === undefined ? hits : hits.slice(0, limit);
}
