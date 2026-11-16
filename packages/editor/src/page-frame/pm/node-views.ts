import type { NodeViewConstructor } from 'prosemirror-view';
import type { EnsureCodeOutputCard } from '../../elements/code-output/bridge';
import { CodeBlockNodeView } from './code-block/node-view';
import type { ResolveMediaSrc } from './embed/renderer';
import { FigureNodeView } from './figure/node-view';
import { MathBlockNodeView } from './math/block-node-view';
import { isMermaidBlock } from './mermaid/detect';
import { MermaidBlockNodeView } from './mermaid/node-view';
import { PageFrameTableNodeView } from './table/node-view';

export function buildNodeViews(
  ensureCodeOutputCard?: EnsureCodeOutputCard,
  resolveMedia?: ResolveMediaSrc,
): Record<string, NodeViewConstructor> {
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
        : new CodeBlockNodeView(node, view, pos, ensureCodeOutputCard);
    },
    figure(node, view, getPos) {
      if (typeof getPos !== 'function') {
        throw new Error('figure node view requires a stable getPos');
      }
      return new FigureNodeView(
        node,
        view,
        () => {
          const pos = getPos();
          if (typeof pos !== 'number') {
            throw new Error('figure node view position is unavailable');
          }
          return pos;
        },
        resolveMedia,
      );
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
