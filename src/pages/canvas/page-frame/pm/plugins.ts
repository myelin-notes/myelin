import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { Plugin as ProseMirrorPlugin } from 'prosemirror-state';
import { tableEditing } from 'prosemirror-tables';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type * as Y from 'yjs';
import { buildKeymap } from './keymap';
import {
  fenceMarkdownInputRules,
  fenceMarkdownNormalizationPlugin,
} from './markdown/fence-commands';
import { linkMarkdownPlugin } from './markdown/links';
import {
  noteLinkMarkdownPlugin,
  type ResolveNoteLink,
} from './markdown/note-links';
import { markdownPastePlugin } from './markdown/paste';
import { markdownPreviewPlugin } from './markdown/plugin';
import { prefixMarkdownInputRules } from './markdown/prefix-rules';
import { paginationPlugin } from './pagination/plugin';
import { schema } from './schema';
import { selectionHighlightPlugin } from './selection-highlight';

function checkListPlugin(schema: Schema): Plugin {
  return new ProseMirrorPlugin({
    props: {
      handleDOMEvents: {
        click(view, event) {
          const target = event.target;
          if (
            !(target instanceof HTMLInputElement) ||
            target.getAttribute('data-check-list-marker') !== 'true'
          ) {
            return false;
          }

          const item = target.closest('.check-list-item');
          if (!item || !view.dom.contains(item)) {
            return false;
          }

          const pos = view.posAtDOM(item, 0);
          let nodePos = pos;
          let checkNode = view.state.doc.nodeAt(nodePos);
          if (checkNode?.type !== schema.nodes.checkListItem) {
            nodePos = pos - 1;
            checkNode = nodePos >= 0 ? view.state.doc.nodeAt(nodePos) : null;
          }
          if (checkNode?.type !== schema.nodes.checkListItem) {
            return false;
          }

          event.preventDefault();
          if (!view.editable) {
            return true;
          }

          view.dispatch(
            view.state.tr.setNodeMarkup(nodePos, undefined, {
              ...checkNode.attrs,
              checked: checkNode.attrs.checked !== true,
            }),
          );
          return true;
        },
      },
    },
  });
}

export function buildPlugins(
  yXmlFragment: Y.XmlFragment,
  onPageCount?: (pageCount: number) => void,
  resolveNoteLink?: ResolveNoteLink,
): Plugin[] {
  const plugins: Plugin[] = [
    ySyncPlugin(yXmlFragment),
    yUndoPlugin(),
    prefixMarkdownInputRules(schema),
    fenceMarkdownInputRules(schema),
    fenceMarkdownNormalizationPlugin(schema),
    noteLinkMarkdownPlugin(schema, resolveNoteLink),
    linkMarkdownPlugin(schema),
    markdownPastePlugin(),
    markdownPreviewPlugin(),
    checkListPlugin(schema),
    buildKeymap(schema),
    paginationPlugin(onPageCount),
    selectionHighlightPlugin(),
    tableEditing(),
  ];
  return plugins;
}
