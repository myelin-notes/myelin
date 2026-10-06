import { type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from 'y-prosemirror';
import * as Y from 'yjs';

export interface AnchorGap {
  id: string;
  pos: number;
  height: number;
}

export const anchorGapsKey = new PluginKey<readonly AnchorGap[]>(
  'page-frame-anchors',
);

export function encodeAnchorPosition(
  state: EditorState,
  pos: number,
): number[] {
  const sync = ySyncPluginKey.getState(state);
  return Array.from(
    Y.encodeRelativePosition(
      absolutePositionToRelativePosition(pos, sync.type, sync.binding.mapping),
    ),
  );
}

export function resolveAnchorPosition(
  state: EditorState,
  position: number[],
  blockPosition?: number[],
): number {
  const sync = ySyncPluginKey.getState(state);
  let resolved = relativePositionToAbsolutePosition(
    sync.doc,
    sync.type,
    Y.decodeRelativePosition(Uint8Array.from(position)),
    sync.binding.mapping,
  );
  if (resolved === null && blockPosition) {
    resolved = relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.decodeRelativePosition(Uint8Array.from(blockPosition)),
      sync.binding.mapping,
    );
  }
  return Math.max(0, Math.min(state.doc.content.size, resolved ?? 0));
}

/** Returns true when a trailing paragraph was inserted; callers must rebind end anchors before it. */
export function setAnchorGaps(
  view: EditorView,
  gaps: readonly AnchorGap[],
  anchorPositions: Iterable<number>,
): boolean {
  const end = view.state.doc.content.size;
  const needsParagraph = Array.from(anchorPositions).some(
    (pos) => pos >= end - 1,
  );
  const previous = anchorGapsKey.getState(view.state) ?? [];
  if (
    !needsParagraph &&
    previous.length === gaps.length &&
    previous.every(
      (gap, i) =>
        gap.id === gaps[i].id &&
        gap.pos === gaps[i].pos &&
        gap.height === gaps[i].height,
    )
  ) {
    return false;
  }
  const tr = view.state.tr
    .setMeta(anchorGapsKey, gaps)
    .setMeta('addToHistory', false);
  if (needsParagraph) {
    tr.insert(end, view.state.schema.nodes.paragraph.create());
  }
  view.dispatch(tr);
  return needsParagraph;
}

export function anchorGapsPlugin(): Plugin {
  return new Plugin<readonly AnchorGap[]>({
    key: anchorGapsKey,
    state: {
      init: () => [],
      apply: (tr, previous) =>
        tr.getMeta(anchorGapsKey) ??
        (tr.docChanged
          ? previous.map((gap) => ({
              ...gap,
              pos: tr.mapping.map(gap.pos, 1),
            }))
          : previous),
    },
    props: {
      decorations(state) {
        return DecorationSet.create(
          state.doc,
          (anchorGapsKey.getState(state) ?? []).map((gap) =>
            Decoration.widget(
              gap.pos,
              () => {
                const dom = document.createElement('span');
                dom.dataset.pageAnchor = gap.id;
                dom.style.cssText = `display:block;height:${gap.height}px;break-inside:avoid;pointer-events:none;user-select:none`;
                dom.contentEditable = 'false';
                return dom;
              },
              {
                side: 0,
                key: `anchor-${gap.id}-${gap.height}`,
                ignoreSelection: true,
              },
            ),
          ),
        );
      },
    },
  });
}
