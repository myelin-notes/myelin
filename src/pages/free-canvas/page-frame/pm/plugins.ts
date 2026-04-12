import { history } from 'prosemirror-history';
import type { Plugin } from 'prosemirror-state';
import { buildKeymap } from './keymap';
import {
  fenceMarkdownInputRules,
  fenceMarkdownNormalizationPlugin,
} from './markdown/fence-commands';
import { markdownPreviewPlugin } from './markdown/plugin';
import { prefixMarkdownInputRules } from './markdown/prefix-rules';
import { paginationPlugin } from './pagination';
import { schema } from './schema';
import { selectionHighlightPlugin } from './selection-highlight';

export function buildPlugins(
  onPageCount?: (pageCount: number) => void,
): Plugin[] {
  const plugins: Plugin[] = [
    prefixMarkdownInputRules(schema),
    fenceMarkdownInputRules(schema),
    fenceMarkdownNormalizationPlugin(schema),
    markdownPreviewPlugin(),
    buildKeymap(schema),
    history(),
    paginationPlugin(onPageCount),
    selectionHighlightPlugin(),
  ];
  return plugins;
}
