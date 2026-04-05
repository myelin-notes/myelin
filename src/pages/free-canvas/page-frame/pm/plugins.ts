import {
  chainCommands,
  deleteSelection,
  exitCode,
  joinBackward,
  joinForward,
  lift,
  liftEmptyBlock,
  newlineInCode,
  selectNodeBackward,
  selectNodeForward,
  splitBlock,
  toggleMark,
} from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import {
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { Schema } from 'prosemirror-model';
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from 'prosemirror-schema-list';
import { type Command, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { schema } from './schema';

// ── Input Rules (Markdown Shortcuts) ────────────────────

function buildInputRules(s: Schema) {
  return inputRules({
    rules: [
      // # Heading 1
      textblockTypeInputRule(/^#\s$/, s.nodes.heading, { level: 1 }),
      // ## Heading 2
      textblockTypeInputRule(/^##\s$/, s.nodes.heading, { level: 2 }),
      // ### Heading 3
      textblockTypeInputRule(/^###\s$/, s.nodes.heading, { level: 3 }),
      // - Bullet list
      wrappingInputRule(/^\s*[-*]\s$/, s.nodes.bulletList),
      // 1. Ordered list
      wrappingInputRule(
        /^\s*(\d+)\.\s$/,
        s.nodes.orderedList,
        (match) => ({ start: Number(match[1]) }),
        (match, node) =>
          node.childCount + node.attrs.start === Number(match[1]),
      ),
      // > Blockquote
      wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
      // ``` Code block
      textblockTypeInputRule(/^```$/, s.nodes.codeBlock),
    ],
  });
}

/**
 * At the start of a non-paragraph textblock (heading, code block),
 * convert it back to a paragraph.
 */
const clearBlockFormatting: Command = (state, dispatch) => {
  const { $cursor } = state.selection as {
    $cursor?: ReturnType<typeof state.doc.resolve>;
  };
  if (!$cursor || $cursor.parentOffset > 0) {
    return false;
  }
  const node = $cursor.parent;
  if (node.type === schema.nodes.paragraph || !node.isTextblock) {
    return false;
  }
  if (dispatch) {
    dispatch(
      state.tr.setBlockType(
        $cursor.before(),
        $cursor.after(),
        schema.nodes.paragraph,
      ),
    );
  }
  return true;
};

// ── Keymaps ─────────────────────────────────────────────

function buildKeymap(s: Schema) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const mod = isMac ? 'Mod' : 'Ctrl';

  return keymap({
    // ── Mark toggles ──
    [`${mod}-b`]: toggleMark(s.marks.bold),
    [`${mod}-i`]: toggleMark(s.marks.italic),
    [`${mod}-u`]: toggleMark(s.marks.underline),
    [`${mod}-e`]: toggleMark(s.marks.code),
    [`${mod}-shift-s`]: toggleMark(s.marks.strikethrough),

    // ── History ──
    [`${mod}-z`]: undo,
    [`${mod}-shift-z`]: redo,
    ...(isMac ? {} : { [`${mod}-y`]: redo }),

    // ── Block operations ──
    Enter: chainCommands(
      newlineInCode,
      splitListItem(s.nodes.listItem),
      liftEmptyBlock,
      splitBlock,
    ),
    Backspace: chainCommands(
      deleteSelection,
      clearBlockFormatting,
      liftListItem(s.nodes.listItem),
      lift,
      joinBackward,
      selectNodeBackward,
    ),
    Delete: chainCommands(deleteSelection, joinForward, selectNodeForward),

    Tab: sinkListItem(s.nodes.listItem),
    'Shift-Tab': liftListItem(s.nodes.listItem),
    'Shift-Enter': exitCode,
  });
}

// ── Pagination (widget decorations) ────────────────────

/** Content area height per page: PAGE_HEIGHT (880) − PAGE_PADDING (48) × 2 */
const CONTENT_HEIGHT = 880 - 48 * 2;
/** Gap to insert between pages: PAGE_PADDING + PAGE_GAP + PAGE_PADDING */
const PAGE_BREAK_GAP = 48 + 40 + 48;

const paginationKey = new PluginKey<DecorationSet>('pagination');

function calculatePageBreaks(
  view: EditorView,
): { pos: number; height: number }[] {
  const breaks: { pos: number; height: number }[] = [];
  let yInPage = 0;

  view.state.doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (!dom?.offsetHeight) {
      return;
    }

    const style = getComputedStyle(dom);
    const blockHeight =
      dom.offsetHeight +
      parseFloat(style.marginTop) +
      parseFloat(style.marginBottom);

    if (yInPage + blockHeight > CONTENT_HEIGHT && yInPage > 0) {
      const remaining = CONTENT_HEIGHT - yInPage;
      breaks.push({ pos: offset, height: remaining + PAGE_BREAK_GAP });
      yInPage = blockHeight;
    } else {
      yInPage += blockHeight;
    }
  });

  return breaks;
}

function paginationPlugin(onPageCount: (n: number) => void): Plugin {
  return new Plugin({
    key: paginationKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, decos) {
        const next = tr.getMeta(paginationKey);
        if (next !== undefined) {
          return next;
        }
        return decos.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return paginationKey.getState(state) ?? DecorationSet.empty;
      },
    },
    view(editorView) {
      let lastKey = '';

      function paginate(view: EditorView) {
        const breaks = calculatePageBreaks(view);
        const key = JSON.stringify(breaks);
        if (key === lastKey) {
          return;
        }
        lastKey = key;

        onPageCount(breaks.length + 1);

        const decos = breaks.map(({ pos, height }) => {
          const spacer = document.createElement('div');
          spacer.style.height = `${height}px`;
          spacer.style.pointerEvents = 'none';
          spacer.style.userSelect = 'none';
          spacer.style.flexShrink = '0';
          return Decoration.widget(pos, spacer, { side: -1 });
        });

        const tr = view.state.tr;
        tr.setMeta(paginationKey, DecorationSet.create(view.state.doc, decos));
        tr.setMeta('addToHistory', false);
        view.dispatch(tr);
      }

      // Initial pagination after DOM is ready.
      requestAnimationFrame(() => paginate(editorView));

      return {
        update(view: EditorView) {
          paginate(view);
        },
      };
    },
  });
}

export function buildPlugins(onPageCount?: (n: number) => void): Plugin[] {
  const plugins: Plugin[] = [
    buildInputRules(schema),
    buildKeymap(schema),
    history(),
  ];
  if (onPageCount) {
    plugins.push(paginationPlugin(onPageCount));
  }
  return plugins;
}
