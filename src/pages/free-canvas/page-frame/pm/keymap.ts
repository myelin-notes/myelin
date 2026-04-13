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
import { undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import type { MarkType, Schema } from 'prosemirror-model';
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from 'prosemirror-schema-list';
import { type Command, Selection } from 'prosemirror-state';
import { redo, undo } from 'y-prosemirror';
import {
  type Action,
  comboToPMKey,
  type KeyCombo,
  registry,
} from '@/lib/keybinds';
import { exitFencedCodeBlock } from './markdown/fence-commands';
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
      exitFencedCodeBlock,
      newlineInCode,
      splitListItem(s.nodes.listItem),
      liftEmptyBlock,
      splitBlock,
    ),
    Backspace: chainCommands(
      deleteSelection,
      undoInputRule,
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
