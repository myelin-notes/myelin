import type { Node as PMNode } from 'prosemirror-model';
import { MARKDOWN_ATOM_CHAR } from './types';

export interface TextOffsetMap {
  text: string;
  posAt: number[];
}

export function buildTextOffsetMap(node: PMNode, pos: number): TextOffsetMap {
  const parts: string[] = [];
  const posAt = [pos + 1];
  let cursorPos = pos + 1;

  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      parts.push(text);
      for (let i = 0; i < text.length; i++) {
        cursorPos += 1;
        posAt.push(cursorPos);
      }
      return;
    }

    if (child.type.name === 'hardBreak') {
      parts.push('\n');
      cursorPos += child.nodeSize;
      posAt.push(cursorPos);
      return;
    }

    parts.push(MARKDOWN_ATOM_CHAR);
    cursorPos += child.nodeSize;
    posAt.push(cursorPos);
  });

  return { text: parts.join(''), posAt };
}
