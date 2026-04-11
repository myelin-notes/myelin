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
import type { MarkType, Schema } from 'prosemirror-model';
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from 'prosemirror-schema-list';
import type { Command } from 'prosemirror-state';
import {
  type Action,
  comboToPMKey,
  type KeyCombo,
  registry,
} from '@/lib/keybinds';
import { schema } from './schema';

declare module '@/lib/keybinds' {
  interface ActionMap {
    'editor:bold': true;
    'editor:italic': true;
    'editor:underline': true;
    'editor:strikethrough': true;
    'editor:code': true;
  }
}

const EDITOR_MARK_ACTIONS: Record<string, KeyCombo & { type: MarkType }> = {
  'editor:bold': { mod: true, key: 'b', type: schema.marks.bold },
  'editor:italic': { mod: true, key: 'i', type: schema.marks.italic },
  'editor:underline': { mod: true, key: 'u', type: schema.marks.underline },
  'editor:strikethrough': {
    mod: true,
    shift: true,
    key: 's',
    type: schema.marks.strikethrough,
  },
  'editor:code': { mod: true, key: 'e', type: schema.marks.code },
};

registry.defineDefaults(EDITOR_MARK_ACTIONS);

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
    const mdDelim = schema.marks.mdDelim;
    if (mdDelim) {
      tr.removeMark($cursor.start(), $cursor.end(), mdDelim);
    }
    tr.setBlockType($cursor.before(), $cursor.after(), schema.nodes.paragraph);
    dispatch(tr);
  }
  return true;
};

export function buildKeymap(s: Schema) {
  const isMac =
    typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const mod = isMac ? 'Mod' : 'Ctrl';

  const markBindings: Record<string, Command> = {};
  for (const [action, defaultCombo] of Object.entries(EDITOR_MARK_ACTIONS)) {
    const combo = registry.getCombo(action as Action) ?? defaultCombo;
    markBindings[comboToPMKey(combo)] = toggleMark(defaultCombo.type);
  }

  return keymap({
    ...markBindings,

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
