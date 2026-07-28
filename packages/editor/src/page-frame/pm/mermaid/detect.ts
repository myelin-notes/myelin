import { OPENING_FENCE_TOKEN_RE } from '../markdown/parse-fences';

/**
 * True when a code block's opening fence names mermaid (```mermaid). Such
 * blocks render as diagrams via MermaidBlockNodeView instead of the plain
 * code editor — the node-view factory and both views' update() consult this
 * to pick (and rebuild to) the right view class.
 */
export function isMermaidBlock(blockText: string): boolean {
  const firstLine = blockText.split('\n', 1)[0] ?? '';
  const token = firstLine.match(OPENING_FENCE_TOKEN_RE)?.[1];
  return token?.toLowerCase() === 'mermaid';
}
