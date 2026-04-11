import { history } from 'prosemirror-history';
import type { Plugin } from 'prosemirror-state';
import { buildKeymap } from './keymap';
import { paginationPlugin } from './pagination';
import { schema } from './schema';

export function buildPlugins(
  onPageCount?: (pageCount: number) => void,
): Plugin[] {
  const plugins: Plugin[] = [
    buildKeymap(schema),
    history(),
    paginationPlugin(onPageCount),
  ];
  return plugins;
}
