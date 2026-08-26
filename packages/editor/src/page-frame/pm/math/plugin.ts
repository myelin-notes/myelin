import type { Node as PMNode } from 'prosemirror-model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Selection,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { parseInlineMarkdown } from '../markdown/parse-inline';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransaction,
} from '../markdown/range-tracking';
import { buildTextOffsetMap } from '../markdown/text-offset-map';
import { positionMathBlockSources } from './block-node-view';
import { renderKatex } from './render';

const mathPreviewKey = new PluginKey<DecorationSet>('math-preview');

// Strictly inside: a cursor at either boundary keeps the rendered preview, so typing next to a
// formula doesn't flash its source.
function selectionTouches(
  selection: Selection,
  from: number,
  to: number,
): boolean {
  return selection.from < to && selection.to > from;
}

interface InlineMathRange {
  from: number;
  to: number;
  src: string;
}

function inlineMathRanges(node: PMNode, pos: number): InlineMathRange[] {
  const { text, posAt } = buildTextOffsetMap(node, pos);
  if (!text.includes('$')) {
    return [];
  }

  const ranges: InlineMathRange[] = [];
  for (const range of parseInlineMarkdown(text).ranges) {
    if (range.kind !== 'math') {
      continue;
    }
    ranges.push({
      from: posAt[range.open.from],
      to: posAt[range.close.to],
      src: text.slice(range.contentFrom, range.contentTo),
    });
  }
  return ranges;
}

// Inline math renders as KaTeX while the selection is elsewhere: an inline decoration hides the
// `$...$` source and a widget draws the formula. Math blocks get an editing class while the
// selection is inside so CSS can swap the node view's preview for the raw source.
function buildMathDecorationsForTextblock(
  node: PMNode,
  pos: number,
  selection: Selection,
): Decoration[] {
  if (node.type.name === 'mathBlock') {
    // Containment, not overlap: a cross-block range keeps the preview, and containment guarantees at
    // most one block edits at a time — the source editor is a single shared CodeMirror instance.
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    if (selection.from < from || selection.to > to) {
      return [];
    }
    return [
      Decoration.node(pos, pos + node.nodeSize, {
        class: 'pm-math-block--editing',
      }),
    ];
  }

  if (node.type.spec.code) {
    return [];
  }

  const decorations: Decoration[] = [];
  for (const { from, to, src } of inlineMathRanges(node, pos)) {
    if (selectionTouches(selection, from, to)) {
      continue;
    }

    decorations.push(
      Decoration.inline(
        from,
        to,
        { class: 'pm-math-source-hidden' },
        { inclusiveStart: false, inclusiveEnd: false },
      ),
      Decoration.widget(
        from,
        (view, getPos) => {
          const el = renderKatex(src, false);
          // Clicking a rendered formula reveals its source with the cursor
          // at the start (just inside the opening `$`).
          el.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const pos = getPos();
            if (pos !== undefined) {
              setCursor(view, pos + 1);
              view.focus();
            }
          });
          return el;
        },
        {
          key: `math:${src}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    );
  }
  return decorations;
}

function buildMathDecorations(state: EditorState): Decoration[] {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }
    decorations.push(
      ...buildMathDecorationsForTextblock(node, pos, state.selection),
    );
    return false;
  });
  return decorations;
}

function setCursor(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  pos: number,
): void {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
  );
}

function addEnclosingTextblock(
  doc: PMNode,
  pos: number,
  targets: Map<number, PMNode>,
): void {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock) {
      targets.set($pos.before(depth), node);
      return;
    }
  }
}

export function mathPreviewPlugin(): Plugin<DecorationSet> {
  return new Plugin({
    key: mathPreviewKey,
    view(view) {
      positionMathBlockSources(view.dom);
      return {
        update(view) {
          positionMathBlockSources(view.dom);
        },
      };
    },
    state: {
      init(_, state) {
        return DecorationSet.create(state.doc, buildMathDecorations(state));
      },
      apply(tr, prev, oldState, newState) {
        const selectionChanged = !oldState.selection.eq(newState.selection);
        if (!tr.docChanged && !selectionChanged) {
          return prev;
        }

        const mapped = tr.docChanged ? prev.map(tr.mapping, tr.doc) : prev;

        // Only blocks touched by the edit, plus those around the old and new selection endpoints, can
        // change content or swap state.
        const dirty = new Map<number, PMNode>();
        if (tr.docChanged) {
          const ranges = getChangedRangesForTransaction(tr);
          for (const { pos, node } of collectAffectedTextblocks(
            newState.doc,
            ranges,
          )) {
            dirty.set(pos, node);
          }
        }
        if (selectionChanged) {
          const { from: oldFrom, to: oldTo } = oldState.selection;
          addEnclosingTextblock(newState.doc, tr.mapping.map(oldFrom), dirty);
          addEnclosingTextblock(newState.doc, tr.mapping.map(oldTo), dirty);
          addEnclosingTextblock(newState.doc, newState.selection.from, dirty);
          addEnclosingTextblock(newState.doc, newState.selection.to, dirty);
        }

        if (dirty.size === 0) {
          return mapped;
        }

        const toRemove = [...dirty.entries()].flatMap(([pos, node]) =>
          mapped.find(pos, pos + node.nodeSize),
        );
        const next = toRemove.length > 0 ? mapped.remove(toRemove) : mapped;
        const toAdd = [...dirty.entries()].flatMap(([pos, node]) =>
          buildMathDecorationsForTextblock(node, pos, newState.selection),
        );
        return toAdd.length > 0 ? next.add(newState.doc, toAdd) : next;
      },
    },
    props: {
      decorations(state) {
        return mathPreviewKey.getState(state) ?? DecorationSet.empty;
      },
      // The browser can't place a caret reliably around display:none source text, so default horizontal
      // arrow movement skips or misplaces the cursor at rendered formulas.
      handleKeyDown(view, event) {
        if (
          (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
          event.shiftKey ||
          event.altKey ||
          event.metaKey ||
          event.ctrlKey
        ) {
          return false;
        }

        const { selection } = view.state;
        if (!selection.empty) {
          return false;
        }
        const $pos = selection.$from;
        const parent = $pos.parent;
        if (!parent.isTextblock || parent.type.spec.code) {
          return false;
        }

        const cursor = selection.from;
        for (const { from, to } of inlineMathRanges(parent, $pos.before())) {
          if (event.key === 'ArrowRight') {
            // Approach → boundary → just inside the opening delimiter (reveals the source) → ... → boundary
            // after, one explicit step at a time. Default movement would skip the hidden text.
            if (cursor === from - 1) {
              setCursor(view, from);
              return true;
            }
            if (cursor === from) {
              setCursor(view, from + 1);
              return true;
            }
            if (cursor === to - 1) {
              setCursor(view, to);
              return true;
            }
          } else {
            if (cursor === to + 1) {
              setCursor(view, to);
              return true;
            }
            if (cursor === to) {
              setCursor(view, to - 1);
              return true;
            }
            if (cursor === from + 1) {
              setCursor(view, from);
              return true;
            }
          }
        }
        return false;
      },
    },
  });
}
