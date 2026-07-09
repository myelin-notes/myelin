import type { NodeViewConstructor } from 'prosemirror-view';
import { CodeBlockNodeView } from './code-block/node-view';
import { MathBlockNodeView } from './math/block-node-view';
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
      return new CodeBlockNodeView(node, view, () => {
        const pos = getPos();
        if (typeof pos !== 'number') {
          throw new Error('codeBlock node view position is unavailable');
        }
        return pos;
      });
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
