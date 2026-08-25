import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

const MATCH_CLASS = 'pm-search-match';
const CURRENT_CLASS = 'pm-search-match pm-search-match-current';

interface SearchHighlightState {
  /** Lowercased literal query; empty clears the highlight. */
  query: string;
  /** Index (in reading order) of the occurrence to mark as current, or null. */
  current: number | null;
  // Recomputed only when the doc or query changes, so stepping through occurrences reuses them
  // instead of rescanning the whole document.
  ranges: { from: number; to: number }[];
}

export const searchHighlightKey = new PluginKey<SearchHighlightState>(
  'searchHighlight',
);

// Literal, case-insensitive, in reading order. Backs both occurrence enumeration and highlighting,
// so a frame's occurrence ordinals line up between the two.
export function findTextMatches(
  doc: PMNode,
  query: string,
): { from: number; to: number }[] {
  const needle = query.toLowerCase();
  if (!needle) {
    return [];
  }
  const matches: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    const haystack = node.text.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      matches.push({ from: pos + at, to: pos + at + needle.length });
      at = haystack.indexOf(needle, at + needle.length);
    }
  });
  return matches;
}

/**
 * State is pushed in via {@link setSearchHighlight}; decorations recompute from the current doc, so
 * positions stay correct as it changes. The view needn't be editable.
 */
export function searchHighlightPlugin(): Plugin<SearchHighlightState> {
  return new Plugin<SearchHighlightState>({
    key: searchHighlightKey,
    state: {
      init: () => ({ query: '', current: null, ranges: [] }),
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(searchHighlightKey) as
          | { query: string; current: number | null }
          | undefined;
        const query = meta ? meta.query : value.query;
        const current = meta ? meta.current : value.current;

        // Match ranges depend only on the doc and the query. When neither
        // changed, reuse the cached ranges and only swap the current index.
        if (!tr.docChanged && query === value.query) {
          return current === value.current ? value : { ...value, current };
        }

        return {
          query,
          current,
          ranges: query ? findTextMatches(newState.doc, query) : [],
        };
      },
    },
    props: {
      decorations(state) {
        const highlight = searchHighlightKey.getState(state);
        if (!highlight?.query || highlight.ranges.length === 0) {
          return DecorationSet.empty;
        }
        return DecorationSet.create(
          state.doc,
          highlight.ranges.map((range, index) =>
            Decoration.inline(range.from, range.to, {
              class: index === highlight.current ? CURRENT_CLASS : MATCH_CLASS,
            }),
          ),
        );
      },
    },
  });
}

export function setSearchHighlight(
  view: EditorView,
  query: string,
  current: number | null,
): void {
  view.dispatch(
    view.state.tr.setMeta(searchHighlightKey, {
      query: query.toLowerCase(),
      current,
    }),
  );
}

export function clearSearchHighlight(view: EditorView): void {
  setSearchHighlight(view, '', null);
}
