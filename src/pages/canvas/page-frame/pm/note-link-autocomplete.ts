import type { Node as PMNode, Schema } from 'prosemirror-model';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type {
  PageFrameAutocompleteItem,
  PageFrameAutocompleteRange,
  PageFrameAutocompleteRequest,
} from './autocomplete';
import { MARKDOWN_ATOM_CHAR } from './markdown/types';

interface TextOffsetMap {
  text: string;
  posAt: number[];
}

export interface ActiveNoteLinkAutocomplete
  extends PageFrameAutocompleteRequest {
  embed: boolean;
  replaceRange: PageFrameAutocompleteRange;
}

function buildTextOffsetMap(node: PMNode, pos: number): TextOffsetMap {
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

function isExactDelimiterRun(
  text: string,
  index: number,
  delimiter: '[[' | ']]',
): boolean {
  if (!text.startsWith(delimiter, index)) {
    return false;
  }

  const char = delimiter[0];
  const before = index > 0 ? text[index - 1] : '';
  const after = text[index + delimiter.length] ?? '';
  return before !== char && after !== char;
}

function findLastExactDelimiter(
  text: string,
  delimiter: '[[' | ']]',
  fromIndex: number,
): number {
  for (
    let index = Math.min(fromIndex, text.length - delimiter.length);
    index >= 0;
    index--
  ) {
    if (isExactDelimiterRun(text, index, delimiter)) {
      return index;
    }
  }
  return -1;
}

function findNextExactDelimiter(
  text: string,
  delimiter: '[[' | ']]',
  fromIndex: number,
): number {
  for (let index = Math.max(0, fromIndex); index <= text.length - 2; index++) {
    if (isExactDelimiterRun(text, index, delimiter)) {
      return index;
    }
  }
  return -1;
}

function containsAutocompleteBarrier(text: string): boolean {
  return text.includes(MARKDOWN_ATOM_CHAR) || text.includes('[[');
}

function rangeEquals(
  left: PageFrameAutocompleteRange | null,
  right: PageFrameAutocompleteRange,
): boolean {
  return left?.from === right.from && left?.to === right.to;
}

export function hasSameAutocompleteRequest(
  left: PageFrameAutocompleteRequest | null,
  right: PageFrameAutocompleteRequest,
): boolean {
  return (
    left?.query === right.query &&
    left?.anchorPosition === right.anchorPosition &&
    rangeEquals(left?.range ?? null, right.range)
  );
}

export function findActiveNoteLinkAutocomplete(
  state: EditorState,
): ActiveNoteLinkAutocomplete | null {
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

  let searchFrom = cursorOffset;
  while (searchFrom >= 0) {
    const openIndex = findLastExactDelimiter(text, '[[', searchFrom);
    if (openIndex === -1) {
      return null;
    }

    const closeBeforeCursor = findLastExactDelimiter(
      text,
      ']]',
      cursorOffset - 1,
    );
    if (closeBeforeCursor > openIndex) {
      searchFrom = openIndex - 1;
      continue;
    }

    if (cursorOffset < openIndex + 2) {
      return null;
    }

    const closeIndex = findNextExactDelimiter(text, ']]', openIndex + 2);
    if (closeIndex !== -1 && cursorOffset > closeIndex) {
      searchFrom = openIndex - 1;
      continue;
    }

    const queryEnd = closeIndex === -1 ? cursorOffset : closeIndex;
    const query = text.slice(openIndex + 2, queryEnd);
    if (containsAutocompleteBarrier(query)) {
      return null;
    }

    const embed = openIndex > 0 && text[openIndex - 1] === '!';
    const replaceFromIndex = embed ? openIndex - 1 : openIndex;

    return {
      embed,
      query,
      range: {
        from: posAt[openIndex + 2],
        to: posAt[queryEnd],
      },
      replaceRange: {
        from: posAt[replaceFromIndex],
        to: closeIndex === -1 ? posAt[cursorOffset] : posAt[closeIndex + 2],
      },
      anchorPosition: state.selection.head,
    };
  }

  return null;
}

export function buildSelectNoteLinkAutocompleteTransaction(
  state: EditorState,
  schema: Schema,
  activeRequest: ActiveNoteLinkAutocomplete,
  item: Pick<PageFrameAutocompleteItem, 'id' | 'title'>,
): Transaction | null {
  const text = activeRequest.embed
    ? `![[${item.title}]]`
    : `[[${item.title}]]`;
  const { from, to } = activeRequest.replaceRange;
  const tr = state.tr.insertText(text, from, to);
  const insertedTo = from + text.length;

  if (activeRequest.embed) {
    tr.setSelection(TextSelection.create(tr.doc, insertedTo));
    return tr;
  }

  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return null;
  }

  tr.addMark(
    from,
    insertedTo,
    noteLinkType.create({
      title: item.title,
      noteId: item.id,
    }),
  );
  tr.setSelection(TextSelection.create(tr.doc, insertedTo));

  return tr;
}
