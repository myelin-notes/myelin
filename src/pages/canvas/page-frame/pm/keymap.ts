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
import type {
  MarkType,
  Node as PMNode,
  ResolvedPos,
  Schema,
} from 'prosemirror-model';
import {
  AllSelection,
  type Command,
  type EditorState,
  Plugin,
  Selection,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { goToNextCell } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { redo, undo } from 'y-prosemirror';
import { type Action, comboToPMKey, registry } from '@/lib/keybinds';
import { parseCalloutMarker } from '../callouts';
import { exitFencedCodeBlock } from './markdown/fence-commands';
import { expandMarkdownLinkCommand } from './markdown/links';
import {
  buildTextOffsetMap,
  type TextOffsetMap,
} from './markdown/text-offset-map';
import { schema } from './schema';
import { exitTableOnLastRow, goToNextTableRow } from './table/commands';

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
    $cursor?: ResolvedPos;
  };
  if (!$cursor) {
    return false;
  }
  const node = $cursor.parent;
  if (
    node.type !== schema.nodes.bulletListItem &&
    node.type !== schema.nodes.orderedListItem &&
    node.type !== schema.nodes.checkListItem
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
        : node.type === schema.nodes.checkListItem
          ? { checked: false, indent }
          : { indent };
    const tr = state.tr.split($cursor.pos, 1, [{ type: node.type, attrs }]);
    dispatch(tr);
  }
  return true;
};

function shouldAddCalloutCaretAnchor($cursor: ResolvedPos): boolean {
  const trailingText = $cursor.parent.textBetween(
    $cursor.parentOffset,
    $cursor.parent.content.size,
    '\n',
    '\n',
  );
  const lineBreakIndex = trailingText.indexOf('\n');
  const restOfLine =
    lineBreakIndex === -1
      ? trailingText
      : trailingText.slice(0, lineBreakIndex);
  return /^[ \t]*$/.test(restOfLine);
}

function isCalloutBlockquote(node: PMNode): boolean {
  return (
    node.type === schema.nodes.blockquote &&
    parseCalloutMarker(node.textBetween(0, node.content.size, '\n', '\n')) !==
      null
  );
}

export const insertNewlineInCallout: Command = (state, dispatch) => {
  const { $cursor } = state.selection as {
    $cursor?: ResolvedPos;
  };
  if (!$cursor) {
    return false;
  }

  const node = $cursor.parent;
  if (!isCalloutBlockquote(node)) {
    return false;
  }

  if (dispatch) {
    const text = shouldAddCalloutCaretAnchor($cursor) ? '\n ' : '\n';
    const tr = state.tr.insertText(text);
    if (text.endsWith(' ')) {
      tr.setSelection(Selection.near(tr.doc.resolve(tr.selection.from - 1)));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
};

function textOffsetAtPos(map: TextOffsetMap, pos: number): number | null {
  const offset = map.posAt.indexOf(pos);
  return offset === -1 ? null : offset;
}

function lineEndAfter(text: string, offset: number): number {
  const lineEnd = text.indexOf('\n', offset);
  return lineEnd === -1 ? text.length : lineEnd;
}

function deleteCalloutRange(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  view: EditorView | undefined,
  from: number,
  to: number,
): void {
  if (!dispatch) {
    return;
  }

  const tr = state.tr.delete(from, to);
  const selectionPos = Math.min(from, tr.doc.content.size);
  dispatch(
    tr
      .setSelection(TextSelection.create(tr.doc, selectionPos))
      .scrollIntoView(),
  );
  setDomTextSelection(view, selectionPos, -1);
}

// After dispatching a transaction that inserts a `\n` + trailing-space caret
// anchor in a callout, PM's selection sync can resolve the cursor onto the
// end of the previous DOM text node (across the `<br>` from
// `linebreakReplacement`) instead of the start of the new line. Force the
// DOM range to the text node we want so the caret renders on the new line.
function setDomTextSelection(
  view: EditorView | undefined,
  pos: number,
  side: -1 | 1,
): void {
  if (!view) {
    return;
  }

  const { node, offset } = view.domAtPos(pos, side);
  if (node.nodeType !== 3) {
    return;
  }

  const doc = view.dom.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) {
    return;
  }

  const range = doc.createRange();
  range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export const deleteBackwardInCallout: Command = (state, dispatch, view) => {
  const { $cursor } = state.selection as {
    $cursor?: ResolvedPos;
  };
  if (!$cursor || !isCalloutBlockquote($cursor.parent)) {
    return false;
  }

  const map = buildTextOffsetMap($cursor.parent, $cursor.before());
  const offset = textOffsetAtPos(map, $cursor.pos);
  if (offset === null || offset === 0) {
    return false;
  }

  const lineStart = map.text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = lineEndAfter(map.text, offset);
  const previousChar = map.text[offset - 1];
  const remainingLine =
    map.text.slice(lineStart, offset - 1) + map.text.slice(offset, lineEnd);
  const isBlankLine = /^[ \t]*$/.test(remainingLine);

  if ((previousChar === '\n' || /^[ \t]$/.test(previousChar)) && isBlankLine) {
    const fromOffset = previousChar === '\n' ? offset - 1 : lineStart - 1;
    if (fromOffset >= 0) {
      deleteCalloutRange(
        state,
        dispatch,
        view,
        map.posAt[fromOffset],
        map.posAt[lineEnd],
      );
      return true;
    }
  }

  if (!dispatch) {
    return true;
  }

  const from = map.posAt[offset - 1];
  const to = map.posAt[offset];
  if (isBlankLine) {
    const tr = state.tr;
    const replaceFrom = lineStart > 0 ? map.posAt[lineStart - 1] : from;
    const replaceTo = lineStart > 0 ? map.posAt[lineEnd] : to;
    const text = lineStart > 0 ? '\n ' : ' ';
    const selectionPos = replaceFrom + text.length - 1;

    tr.delete(replaceFrom, replaceTo);
    tr.insertText(text, replaceFrom);
    tr.setSelection(TextSelection.create(tr.doc, selectionPos));
    dispatch(tr.scrollIntoView());
    setDomTextSelection(view, selectionPos, 1);
  } else {
    const tr = state.tr.delete(from, to);
    tr.setSelection(TextSelection.create(tr.doc, from));
    dispatch(tr.scrollIntoView());
    setDomTextSelection(view, from, offset - 1 === lineStart ? 1 : -1);
  }
  return true;
};

interface DeleteRange {
  from: number;
  to: number;
}

function collectCalloutCaretAnchorDeletes(
  node: PMNode,
  pos: number,
): DeleteRange[] {
  if (node.type !== schema.nodes.blockquote) {
    return [];
  }

  const { posAt, text } = buildTextOffsetMap(node, pos);
  if (!parseCalloutMarker(text)) {
    return [];
  }

  const deletes: DeleteRange[] = [];
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== '\n') {
      continue;
    }

    let trailingStart = i;
    while (trailingStart > lineStart && /[ \t]/.test(text[trailingStart - 1])) {
      trailingStart--;
    }
    if (trailingStart < i && /\S/.test(text.slice(lineStart, trailingStart))) {
      deletes.push({ from: posAt[trailingStart], to: posAt[i] });
    }

    lineStart = i + 1;
  }

  return deletes;
}

export function calloutCaretAnchorCleanupPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) {
        return null;
      }

      const deletes: DeleteRange[] = [];
      newState.doc.descendants((node, pos) => {
        deletes.push(...collectCalloutCaretAnchorDeletes(node, pos));
        return true;
      });
      if (deletes.length === 0) {
        return null;
      }

      const tr = newState.tr;
      for (const range of deletes.sort((a, b) => b.from - a.from)) {
        tr.delete(range.from, range.to);
      }
      return tr;
    },
  });
}

const MAX_INDENT = 4;

const indentListItem: Command = (state, dispatch) => {
  const { $cursor } = state.selection as {
    $cursor?: ResolvedPos;
  };
  if (!$cursor) {
    return false;
  }
  const node = $cursor.parent;
  if (
    node.type !== schema.nodes.bulletListItem &&
    node.type !== schema.nodes.orderedListItem &&
    node.type !== schema.nodes.checkListItem
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
    $cursor?: ResolvedPos;
  };
  if (!$cursor) {
    return false;
  }
  const node = $cursor.parent;
  if (
    node.type !== schema.nodes.bulletListItem &&
    node.type !== schema.nodes.orderedListItem &&
    node.type !== schema.nodes.checkListItem
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
    $cursor?: ResolvedPos;
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
      goToNextTableRow,
      splitFlatListItem,
      insertNewlineInCallout,
      liftEmptyBlock,
      splitBlock,
    ),
    Backspace: chainCommands(
      deleteSelection,
      undoInputRule,
      clearBlockFormatting,
      expandMarkdownLinkCommand,
      deleteBackwardInCallout,
      joinBackward,
      selectNodeBackward,
    ),
    Delete: chainCommands(deleteSelection, joinForward, selectNodeForward),
    Tab: chainCommands(goToNextCell(1), indentListItem),
    'Shift-Tab': chainCommands(goToNextCell(-1), dedentListItem),
    [`${mod}-Enter`]: exitTableOnLastRow,
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
