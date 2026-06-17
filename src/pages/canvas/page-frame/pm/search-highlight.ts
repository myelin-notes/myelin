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
}

export const searchHighlightKey = new PluginKey<SearchHighlightState>(
  'searchHighlight',
);

/**
 * Every occurrence of `query` (literal, case-insensitive) across the doc's text
 * nodes, in reading order. The same function backs both occurrence enumeration
 * (for the match list) and highlighting, so a frame's occurrence ordinals line
 * up between the two.
 */
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
 * Highlights search matches inside a page frame, with the current match marked
 * distinctly so in-canvas find can step through occurrences. State is pushed in
 * via {@link setSearchHighlight}; decorations recompute from the current doc, so
 * positions stay correct as the document changes. The view needn't be editable.
 */
export function searchHighlightPlugin(): Plugin<SearchHighlightState> {
  return new Plugin<SearchHighlightState>({
    key: searchHighlightKey,
    state: {
      init: () => ({ query: '', current: null }),
      apply(tr, value) {
        const meta = tr.getMeta(searchHighlightKey);
        return meta ? (meta as SearchHighlightState) : value;
      },
    },
    props: {
      decorations(state) {
        const highlight = searchHighlightKey.getState(state);
        if (!highlight?.query) {
          return DecorationSet.empty;
        }
        const ranges = findTextMatches(state.doc, highlight.query);
        if (ranges.length === 0) {
          return DecorationSet.empty;
        }
        return DecorationSet.create(
          state.doc,
          ranges.map((range, index) =>
            Decoration.inline(range.from, range.to, {
              class: index === highlight.current ? CURRENT_CLASS : MATCH_CLASS,
            }),
          ),
        );
      },
    },
  });
}

/** Highlight `query` in this view, marking the `current`-th occurrence. */
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
