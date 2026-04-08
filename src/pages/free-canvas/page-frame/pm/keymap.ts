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
import { redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Schema } from 'prosemirror-model';
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from 'prosemirror-schema-list';
import type { Command } from 'prosemirror-state';
import { schema } from './schema';

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
    const tr = state.tr;
    // The reverted paragraph shouldn't carry leftover `mdDelim` marks from
    // when it was a heading/codeBlock — those only make sense inside the
    // block types the markdown auto-format converts to.
    const mdDelim = schema.marks.mdDelim;
    if (mdDelim) {
      tr.removeMark($cursor.start(), $cursor.end(), mdDelim);
    }
    tr.setBlockType(
      $cursor.before(),
      $cursor.after(),
      schema.nodes.paragraph,
    );
    dispatch(tr);
  }
  return true;
};

export function buildKeymap(s: Schema) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const mod = isMac ? 'Mod' : 'Ctrl';

  return keymap({
    [`${mod}-b`]: toggleMark(s.marks.bold),
    [`${mod}-i`]: toggleMark(s.marks.italic),
    [`${mod}-u`]: toggleMark(s.marks.underline),
    [`${mod}-e`]: toggleMark(s.marks.code),
    [`${mod}-shift-s`]: toggleMark(s.marks.strikethrough),

    [`${mod}-z`]: undo,
    [`${mod}-shift-z`]: redo,
    ...(isMac ? {} : { [`${mod}-y`]: redo }),

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
