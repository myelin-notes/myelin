import { type Schema, Slice } from 'prosemirror-model';
import { type EditorState, Plugin, type Transaction } from 'prosemirror-state';
import { parseMarkdownToDoc } from '../../markdown-parser';

const HEADING_RE = /^(#{1,6})\s+\S/;
const BULLET_RE = /^\s*[-*+]\s+\S/;
const ORDERED_RE = /^\s*\d+\.\s+\S/;
const QUOTE_RE = /^>\s?\S/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE_RE = /^```/;
const TABLE_ROW_RE = /\|/;
const TABLE_DIVIDER_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function isTableStart(lines: readonly string[], index: number): boolean {
  return (
    index + 1 < lines.length &&
    TABLE_ROW_RE.test(lines[index]) &&
    TABLE_DIVIDER_RE.test(lines[index + 1])
  );
}

export function isBlockMarkdownPaste(text: string): boolean {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized.trim().length === 0) {
    return false;
  }

  const lines = normalized.split('\n');
  return lines.some((line, index) => {
    const trimmed = line.trim();
    return (
      FENCE_RE.test(trimmed) ||
      HR_RE.test(trimmed) ||
      HEADING_RE.test(line) ||
      BULLET_RE.test(line) ||
      ORDERED_RE.test(line) ||
      QUOTE_RE.test(line) ||
      isTableStart(lines, index)
    );
  });
}

export function buildMarkdownPasteSlice(
  text: string,
  schema: Schema,
): Slice | null {
  if (!isBlockMarkdownPaste(text)) {
    return null;
  }

  const doc = parseMarkdownToDoc(text, schema);
  return new Slice(doc.content, 0, 0);
}

export function buildMarkdownPasteTransaction(
  state: EditorState,
  text: string,
): Transaction | null {
  const slice = buildMarkdownPasteSlice(text, state.schema);
  if (!slice) {
    return null;
  }

  return state.tr.replaceSelection(slice).scrollIntoView();
}

export function markdownPastePlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const tr = buildMarkdownPasteTransaction(view.state, text);
        if (!tr) {
          return false;
        }

        event.preventDefault();
        view.dispatch(tr);
        return true;
      },
    },
  });
}
