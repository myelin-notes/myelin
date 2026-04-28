import { type Node as PMNode, type Schema, Slice } from 'prosemirror-model';
import { type EditorState, Plugin, type Transaction } from 'prosemirror-state';
import { parseMarkdownToDoc } from '../../markdown-parser';

export function hasParsedMarkdownBlock(doc: PMNode): boolean {
  let hasBlock = false;
  doc.forEach((node) => {
    if (node.type.name !== 'paragraph') {
      hasBlock = true;
    }
  });
  return hasBlock;
}

export function buildMarkdownPasteSlice(
  text: string,
  schema: Schema,
): Slice | null {
  if (text.trim().length === 0) {
    return null;
  }

  const doc = parseMarkdownToDoc(text, schema);
  if (!hasParsedMarkdownBlock(doc)) {
    return null;
  }

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
