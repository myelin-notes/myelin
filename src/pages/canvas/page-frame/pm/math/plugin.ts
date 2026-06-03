import type { Node as PMNode } from 'prosemirror-model';
import {
  type EditorState,
  Plugin,
  PluginKey,
  type Selection,
  TextSelection,
} from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { parseInlineMarkdown } from '../markdown/parse-inline';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransaction,
} from '../markdown/range-tracking';
import { buildTextOffsetMap } from '../markdown/text-offset-map';
import { renderKatex } from './render';

const mathPreviewKey = new PluginKey<DecorationSet>('math-preview');

const REPLACE_SPEC_KIND = 'math-inline-replace';

function selectionTouches(
  selection: Selection,
  from: number,
  to: number,
): boolean {
  return selection.from <= to && selection.to >= from;
}

/**
 * Inline math sources render as KaTeX while the selection is elsewhere: an
 * inline decoration hides the `$...$` source and a widget draws the formula
 * in its place. Math blocks get an editing class while the selection is
 * inside so CSS can swap the node view's preview for the raw source.
 */
function buildMathDecorationsForTextblock(
  node: PMNode,
  pos: number,
  selection: Selection,
): Decoration[] {
  if (node.type.name === 'mathBlock') {
    if (!selectionTouches(selection, pos, pos + node.nodeSize)) {
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

  const { text, posAt } = buildTextOffsetMap(node, pos);
  if (!text.includes('$')) {
    return [];
  }

  const decorations: Decoration[] = [];
  for (const range of parseInlineMarkdown(text).ranges) {
    if (range.kind !== 'math') {
      continue;
    }

    const from = posAt[range.open.from];
    const to = posAt[range.close.to];
    if (selectionTouches(selection, from, to)) {
      continue;
    }

    const src = text.slice(range.contentFrom, range.contentTo);
    decorations.push(
      Decoration.inline(
        from,
        to,
        { class: 'pm-math-source-hidden' },
        {
          kind: REPLACE_SPEC_KIND,
          inclusiveStart: false,
          inclusiveEnd: false,
        },
      ),
      Decoration.widget(from, () => renderKatex(src, false), {
        key: `math:${src}`,
        ignoreSelection: true,
        kind: REPLACE_SPEC_KIND,
      }),
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

        // Only textblocks whose content or swap state can change need a
        // rebuild: blocks touched by the edit plus the blocks around the old
        // and new selection endpoints.
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
      handleClick(view, pos, event) {
        const target = event.target;
        if (
          !(target instanceof Element) ||
          !target.closest('.pm-math-inline')
        ) {
          return false;
        }

        const set = mathPreviewKey.getState(view.state);
        const replace = set
          ?.find(pos - 1, pos + 1)
          .find(
            (deco) =>
              deco.spec.kind === REPLACE_SPEC_KIND && deco.to > deco.from,
          );
        if (!replace) {
          return false;
        }

        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, replace.from + 1),
          ),
        );
        return true;
      },
    },
  });
}
