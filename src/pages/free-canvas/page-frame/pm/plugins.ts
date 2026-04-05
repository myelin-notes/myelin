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
import type { Command, Plugin } from 'prosemirror-state';
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

export function buildPlugins(): Plugin[] {
  return [buildInputRules(schema), buildKeymap(schema), history()];
}
