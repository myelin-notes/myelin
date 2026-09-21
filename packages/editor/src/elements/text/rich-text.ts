import { type Node as ProseMirrorNode, Schema } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import {
  selectionSomeText,
  uniformSelectionMarkAttrs,
} from '../../prosemirror/selection-marks';
import type { TextStyle } from './element';

export const textSchema = new Schema({
  nodes: {
    doc: { content: 'inline*' },
    text: { group: 'inline' },
    hardBreak: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks: {
    textStyle: {
      attrs: {
        color: { default: null },
        fontSize: { default: null },
        fontFamily: { default: null },
        bold: { default: null },
        italic: { default: null },
      },
      toDOM(mark) {
        const { color, fontSize, fontFamily, bold, italic } = mark.attrs;
        const style = [
          color ? `color: ${color}` : '',
          fontSize ? `font-size: ${fontSize}px; line-height: 1.3` : '',
          fontFamily ? `font-family: ${fontFamily}` : '',
          typeof bold === 'boolean'
            ? `font-weight: ${bold ? '700' : '400'}`
            : '',
          typeof italic === 'boolean'
            ? `font-style: ${italic ? 'italic' : 'normal'}`
            : '',
        ]
          .filter(Boolean)
          .join('; ');
        return ['span', { style }, 0];
      },
    },
  },
});

export function docFromText(text: string): ProseMirrorNode {
  const content: ProseMirrorNode[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) {
      content.push(textSchema.text(lines[i]));
    }
    if (i < lines.length - 1) {
      content.push(textSchema.nodes.hardBreak.create());
    }
  }
  return textSchema.nodes.doc.create(null, content);
}

export function docFromJson(
  value: unknown,
  fallbackText: string,
): ProseMirrorNode {
  try {
    return textSchema.nodeFromJSON(value);
  } catch {
    return docFromText(fallbackText);
  }
}

export function getDocText(doc: ProseMirrorNode): string {
  return doc.textBetween(0, doc.content.size, '\n', '\n');
}

export function getSelectionStyle(
  state: EditorState,
  base: TextStyle,
): TextStyle {
  const type = textSchema.marks.textStyle;
  const attrs = state.selection.empty
    ? type.isInSet(state.storedMarks ?? state.selection.$from.marks())?.attrs
    : uniformSelectionMarkAttrs(state, type);
  const style = resolveStyle(attrs, base);
  if (!state.selection.empty) {
    style.bold = selectionSomeText(state, (marks) => {
      const value = type.isInSet(marks)?.attrs.bold;
      return typeof value === 'boolean' ? value : base.bold;
    });
    style.italic = selectionSomeText(state, (marks) => {
      const value = type.isInSet(marks)?.attrs.italic;
      return typeof value === 'boolean' ? value : base.italic;
    });
  }
  return style;
}

export function getDocumentStyle(
  doc: ProseMirrorNode,
  base: TextStyle,
): TextStyle {
  let style = base;
  let foundText = false;
  doc.descendants((node) => {
    if (!node.isText || foundText) {
      return;
    }
    foundText = true;
    const attributed = node.marks.find(
      (mark) => mark.type === textSchema.marks.textStyle,
    );
    style = resolveStyle(attributed?.attrs, base);
  });
  return style;
}

function resolveStyle(
  attrs: Record<string, unknown> | null | undefined,
  base: TextStyle,
): TextStyle {
  return {
    color: typeof attrs?.color === 'string' ? attrs.color : base.color,
    fontSize:
      typeof attrs?.fontSize === 'number' ? attrs.fontSize : base.fontSize,
    fontFamily:
      typeof attrs?.fontFamily === 'string'
        ? attrs.fontFamily
        : base.fontFamily,
    bold: typeof attrs?.bold === 'boolean' ? attrs.bold : base.bold,
    italic: typeof attrs?.italic === 'boolean' ? attrs.italic : base.italic,
  };
}

export function applyDocumentStyle(
  state: EditorState,
  updates: Partial<TextStyle>,
): Transaction {
  return applyStyleRange(state, updates, 0, state.doc.content.size);
}

export function applySelectionStyle(
  state: EditorState,
  updates: Partial<TextStyle>,
): Transaction {
  const { from, to, empty } = state.selection;
  const tr = state.tr;

  const attributedUpdates = Object.fromEntries(
    (['color', 'fontSize', 'fontFamily', 'bold', 'italic'] as const)
      .filter((key) => updates[key] !== undefined)
      .map((key) => [key, updates[key]]),
  );
  if (Object.keys(attributedUpdates).length === 0) {
    return tr;
  }

  const type = textSchema.marks.textStyle;
  if (empty) {
    const marks =
      tr.storedMarks ?? state.storedMarks ?? state.selection.$from.marks();
    const current = marks.find((mark) => mark.type === type);
    return tr.setStoredMarks(
      type.create({ ...current?.attrs, ...attributedUpdates }).addToSet(marks),
    );
  }

  return applyStyleRange(state, updates, from, to);
}

function applyStyleRange(
  state: EditorState,
  updates: Partial<TextStyle>,
  from: number,
  to: number,
): Transaction {
  let tr = state.tr;
  const type = textSchema.marks.textStyle;
  const attributedUpdates = Object.fromEntries(
    (['color', 'fontSize', 'fontFamily', 'bold', 'italic'] as const)
      .filter((key) => updates[key] !== undefined)
      .map((key) => [key, updates[key]]),
  );
  if (Object.keys(attributedUpdates).length === 0) {
    return tr;
  }

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) {
      return;
    }
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    const current = node.marks.find((mark) => mark.type === type);
    tr = tr
      .removeMark(start, end, type)
      .addMark(
        start,
        end,
        type.create({ ...current?.attrs, ...attributedUpdates }),
      );
  });
  return tr;
}
