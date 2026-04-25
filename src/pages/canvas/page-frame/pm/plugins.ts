import type { Plugin } from 'prosemirror-state';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type * as Y from 'yjs';
import { buildKeymap } from './keymap';
import {
  fenceMarkdownInputRules,
  fenceMarkdownNormalizationPlugin,
} from './markdown/fence-commands';
import {
  type ResolveNoteLinkId,
  noteLinkMarkdownPlugin,
} from './markdown/note-links';
import { markdownPreviewPlugin } from './markdown/plugin';
import { prefixMarkdownInputRules } from './markdown/prefix-rules';
import { paginationPlugin } from './pagination';
import { schema } from './schema';
import { selectionHighlightPlugin } from './selection-highlight';

export function buildPlugins(
  yXmlFragment: Y.XmlFragment,
  onPageCount?: (pageCount: number) => void,
  resolveNoteLinkId?: ResolveNoteLinkId,
): Plugin[] {
  const plugins: Plugin[] = [
    ySyncPlugin(yXmlFragment),
    yUndoPlugin(),
    prefixMarkdownInputRules(schema),
    fenceMarkdownInputRules(schema),
    fenceMarkdownNormalizationPlugin(schema),
    noteLinkMarkdownPlugin(schema, resolveNoteLinkId),
    markdownPreviewPlugin(),
    buildKeymap(schema),
    paginationPlugin(onPageCount),
    selectionHighlightPlugin(),
  ];
  return plugins;
}
