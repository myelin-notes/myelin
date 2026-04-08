import { history } from 'prosemirror-history';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { markdownAutoFormatPlugin } from './input-rules';
import { buildKeymap } from './keymap';
import { paginationPlugin } from './pagination';
import { schema } from './schema';

/**
 * WKWebView won't compute a renderable rect for a selection inside an empty
 * textblock that contains only PM's trailing-`<br>` filler — `getClientRects()`
 * returns nothing, so the browser has nowhere to draw the caret. This plugin
 * inserts a zero-width-space widget at the start of every empty textblock so
 * the selection range has a real DOM node to anchor on.
 */
function emptyBlockCaretPlaceholder(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.content.size === 0) {
            decos.push(
              Decoration.widget(
                pos + 1,
                () => {
                  const span = document.createElement('span');
                  span.className = 'pm-caret-anchor';
                  span.textContent = '\u200B';
                  return span;
                },
                { side: -1 },
              ),
            );
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

export function buildPlugins(
  onPageCount?: (pageCount: number) => void,
): Plugin[] {
  const plugins: Plugin[] = [
    markdownAutoFormatPlugin(schema),
    buildKeymap(schema),
    emptyBlockCaretPlaceholder(),
    history(),
  ];
  if (onPageCount) {
    plugins.push(paginationPlugin(onPageCount));
  }
  return plugins;
}
