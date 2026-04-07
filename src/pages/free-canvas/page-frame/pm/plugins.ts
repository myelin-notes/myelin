import { history } from 'prosemirror-history';
import type { Plugin } from 'prosemirror-state';
import { buildInputRules } from './input-rules';
import { buildKeymap } from './keymap';
import { paginationPlugin } from './pagination';
import { schema } from './schema';

export function buildPlugins(
  onPageCount?: (pageCount: number) => void,
): Plugin[] {
  const plugins: Plugin[] = [
    buildInputRules(schema),
    buildKeymap(schema),
    history(),
  ];
  if (onPageCount) {
    plugins.push(paginationPlugin(onPageCount));
  }
  return plugins;
}
