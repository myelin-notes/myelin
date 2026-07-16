import type { NodeViewConstructor } from 'prosemirror-view';
import { CodeBlockNodeView } from './code-block/node-view';
import { MathBlockNodeView } from './math/block-node-view';
import { isMermaidBlock } from './mermaid/detect';
import { MermaidBlockNodeView } from './mermaid/node-view';
import { PageFrameTableNodeView } from './table/node-view';

export function buildNodeViews(): Record<string, NodeViewConstructor> {
  return {
    mathBlock(node, view, getPos) {
      if (typeof getPos !== 'function') {
        throw new Error('mathBlock node view requires a stable getPos');
      }
      return new MathBlockNodeView(node, view, () => {
        const pos = getPos();
        if (typeof pos !== 'number') {
          throw new Error('mathBlock node view position is unavailable');
        }
        return pos;
      });
    },
    codeBlock(node, view, getPos) {
      if (typeof getPos !== 'function') {
        throw new Error('codeBlock node view requires a stable getPos');
      }
      const pos = () => {
        const value = getPos();
        if (typeof value !== 'number') {
          throw new Error('codeBlock node view position is unavailable');
        }
        return value;
      };
      // Mermaid fences render as diagrams; both views' update() returns
      // false when the fence language crosses this boundary, so ProseMirror
      // rebuilds through here with the right class.
      return isMermaidBlock(node.textContent)
        ? new MermaidBlockNodeView(node, view, pos)
        : new CodeBlockNodeView(node, view, pos);
    },
    table(node, view, getPos) {
      if (typeof getPos !== 'function') {
        throw new Error('table node view requires a stable getPos');
      }
      return new PageFrameTableNodeView(node, view, () => {
        const pos = getPos();
        if (typeof pos !== 'number') {
          throw new Error('table node view position is unavailable');
        }
        return pos;
      });
    },
  };
}
