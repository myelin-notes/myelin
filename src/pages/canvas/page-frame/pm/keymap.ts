import {
  chainCommands,
  deleteSelection,
  exitCode,
  joinBackward,
  joinForward,
  liftEmptyBlock,
  newlineInCode,
  selectNodeBackward,
  selectNodeForward,
  splitBlock,
  toggleMark,
} from 'prosemirror-commands';
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, Schema } from 'prosemirror-model';
import { AllSelection, type Command, Selection } from 'prosemirror-state';
import { goToNextCell } from 'prosemirror-tables';
import { redo, undo } from 'y-prosemirror';
import { type Action, comboToPMKey, registry } from '@/lib/keybinds';
import { exitFencedCodeBlock } from './markdown/fence-commands';
import { schema } from './schema';

const EDITOR_MARK_ACTIONS: Record<string, { type: MarkType }> = {
  'editor:bold': { type: schema.marks.bold },
  'editor:italic': { type: schema.marks.italic },
  'editor:underline': { type: schema.marks.underline },
  'editor:strikethrough': { type: schema.marks.strikethrough },
  'editor:code': { type: schema.marks.code },
};

/**
 * Enter inside a flat list-item textblock: split into a new item of the
 * same type, or convert an empty item back to a paragraph.
 */
const splitFlatListItem: Command = (state, dispatch) => {
  const { $cursor } = state.selection as {
    $cursor?: ReturnType<typeof state.doc.resolve>;
  };
  if (!$cursor) {
    return false;
  }
  const node = $cursor.parent;
  if (
    node.type !== schema.nodes.bulletListItem &&
    node.type !== schema.nodes.orderedListItem
  ) {
    return false;
  }
  if (node.content.size === 0) {
    if (dispatch) {
      const tr = state.tr.setBlockType(
        $cursor.before(),
        $cursor.after(),
        schema.nodes.paragraph,
      );
      dispatch(tr);
    }
    return true;
  }
  if (dispatch) {
    const indent = node.attrs.indent as number;
    const attrs =
      node.type === schema.nodes.orderedListItem
        ? { order: (node.attrs.order as number) + 1, indent }
        : { indent };
    const tr = state.tr.split($cursor.pos, 1, [{ type: node.type, attrs }]);
    dispatch(tr);
  }
  return true;
};

const MAX_INDENT = 4;

const indentListItem: Command = (state, dispatch) => {
  const { $cursor } = state.selection as {
    $cursor?: ReturnType<typeof state.doc.resolve>;
  };
  if (!$cursor) {
    return false;
  }
  const node = $cursor.parent;
  if (
    node.type !== schema.nodes.bulletListItem &&
    node.type !== schema.nodes.orderedListItem
  ) {
    return false;
  }
  const indent = (node.attrs.indent as number) || 0;
  if (indent >= MAX_INDENT) {
    return true;
  }
  if (dispatch) {
    const pos = $cursor.before();
    dispatch(
      state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        indent: indent + 1,
      }),
    );
  }
  return true;
};

const dedentListItem: Command = (state, dispatch) => {
  const { $cursor } = state.selection as {
    $cursor?: ReturnType<typeof state.doc.resolve>;
  };
  if (!$cursor) {
    return false;
  }
  const node = $cursor.parent;
  if (
    node.type !== schema.nodes.bulletListItem &&
    node.type !== schema.nodes.orderedListItem
  ) {
    return false;
  }
  const indent = (node.attrs.indent as number) || 0;
  if (indent <= 0) {
    return false;
  }
  if (dispatch) {
    const pos = $cursor.before();
    dispatch(
      state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        indent: indent - 1,
      }),
    );
  }
  return true;
};

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
    tr.setBlockType($cursor.before(), $cursor.after(), schema.nodes.paragraph);
    dispatch(tr);
  }
  return true;
};

const selectAllPageFrame: Command = (state, dispatch) => {
  dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
  return true;
};

export function buildKeymap(s: Schema) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const mod = isMac ? 'Mod' : 'Ctrl';

  const markBindings: Record<string, Command> = {};
  for (const [action, entry] of Object.entries(EDITOR_MARK_ACTIONS)) {
    const combo = registry.getCombo(action as Action);
    if (combo) {
      markBindings[comboToPMKey(combo)] = toggleMark(entry.type);
    }
  }

  return keymap({
    ...markBindings,

    [`${mod}-z`]: undo,
    [`${mod}-shift-z`]: redo,
    ...(isMac ? {} : { [`${mod}-y`]: redo }),
    [`${mod}-a`]: selectAllPageFrame,

    Enter: chainCommands(
      exitFencedCodeBlock,
      newlineInCode,
      splitFlatListItem,
      liftEmptyBlock,
      splitBlock,
    ),
    Backspace: chainCommands(
      deleteSelection,
      undoInputRule,
      clearBlockFormatting,
      joinBackward,
      selectNodeBackward,
    ),
    Delete: chainCommands(deleteSelection, joinForward, selectNodeForward),
    Tab: chainCommands(goToNextCell(1), indentListItem),
    'Shift-Tab': chainCommands(goToNextCell(-1), dedentListItem),
    'Shift-Enter': exitCode,
    ArrowLeft: arrowHandler('left', s),
    ArrowRight: arrowHandler('right', s),
    ArrowUp: arrowHandler('up', s),
    ArrowDown: arrowHandler('down', s),
  });
}

function arrowHandler(
  dir: 'left' | 'right' | 'up' | 'down',
  schema: Schema,
): Command {
  return (state, dispatch, view) => {
    if (!view || !state.selection.empty || !view.endOfTextblock(dir)) {
      return false;
    }

    const side = dir === 'left' || dir === 'up' ? -1 : 1;
    const { $head } = state.selection;
    const nextSelection = Selection.near(
      state.doc.resolve(side > 0 ? $head.after() : $head.before()),
      side,
    );
    if (nextSelection.$head.parent.type !== schema.nodes.codeBlock) {
      return false;
    }

    dispatch?.(state.tr.setSelection(nextSelection));
    return true;
  };
}
