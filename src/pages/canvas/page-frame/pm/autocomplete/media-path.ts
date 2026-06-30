import type { Schema } from 'prosemirror-model';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { MARKDOWN_ATOM_CHAR } from '../markdown/types';
import type {
  PageFrameAutocompleteItem,
  PageFrameAutocompleteRange,
  PageFrameAutocompleteRequest,
} from './index';

interface TextOffsetMap {
  text: string;
  posAt: number[];
}

export interface ActiveMediaPathAutocomplete
  extends PageFrameAutocompleteRequest {
  replaceRange: PageFrameAutocompleteRange;
}

// `![alt](url` up to the cursor, where url has no closing paren (spaces are
// allowed so library paths like `/My Pics/cat.png` autocomplete directly).
const MEDIA_PATH_RE = /!\[[^\]\n]*\]\(([^)\n]*)$/;

function buildTextOffsetMap(
  node: EditorState['selection']['$from']['parent'],
  pos: number,
): TextOffsetMap {
  const parts: string[] = [];
  const posAt = [pos + 1];
  let cursorPos = pos + 1;

  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      parts.push(text);
      for (let index = 0; index < text.length; index++) {
        cursorPos += 1;
        posAt.push(cursorPos);
      }
      return;
    }

    parts.push(MARKDOWN_ATOM_CHAR);
    cursorPos += child.nodeSize;
    posAt.push(cursorPos);
  });

  return {
    text: parts.join(''),
    posAt,
  };
}

export function findActiveMediaPathAutocomplete(
  state: EditorState,
): ActiveMediaPathAutocomplete | null {
  if (!state.selection.empty || state.selection.$from.parent.type.spec.code) {
    return null;
  }

  const parent = state.selection.$from.parent;
  const parentPos = state.selection.$from.before();
  const { text, posAt } = buildTextOffsetMap(parent, parentPos);
  const cursorOffset = posAt.indexOf(state.selection.head);
  if (cursorOffset === -1) {
    return null;
  }

  const match = text.slice(0, cursorOffset).match(MEDIA_PATH_RE);
  if (!match) {
    return null;
  }

  // Only library paths (rooted at `/`) trigger autocomplete; external URLs and
  // protocol-relative `//host` paths are left alone.
  const url = match[1];
  if (
    !url.startsWith('/') ||
    url.startsWith('//') ||
    url.includes(MARKDOWN_ATOM_CHAR)
  ) {
    return null;
  }

  const urlStartOffset = cursorOffset - url.length;
  const range: PageFrameAutocompleteRange = {
    from: posAt[urlStartOffset],
    to: posAt[cursorOffset],
  };
  return {
    query: url,
    range,
    replaceRange: range,
    anchorPosition: state.selection.head,
  };
}

export function buildSelectMediaPathAutocompleteTransaction(
  state: EditorState,
  _schema: Schema,
  activeRequest: ActiveMediaPathAutocomplete,
  item: PageFrameAutocompleteItem,
): Transaction | null {
  const insertText = item.insertText ?? item.title;
  const { from, to } = activeRequest.replaceRange;
  const tr = state.tr.insertText(insertText, from, to);
  tr.setSelection(TextSelection.create(tr.doc, from + insertText.length));
  return tr;
}
