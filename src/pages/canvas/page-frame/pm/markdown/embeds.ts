import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { renderEmbedHost } from '../embed/renderer';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransaction,
} from './range-tracking';
import { buildTextOffsetMap } from './text-offset-map';
import { MARKDOWN_ATOM_CHAR } from './types';

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

interface EmbedHit {
  url: string;
  alt: string | null;
}

function findEmbedHitsForBlock(node: PMNode): EmbedHit[] {
  const { text } = buildTextOffsetMap(node, 0);
  if (!text.includes('![') || !text.includes('](')) {
    return [];
  }

  const hits: EmbedHit[] = [];
  IMAGE_RE.lastIndex = 0;
  for (const match of text.matchAll(IMAGE_RE)) {
    const full = match[0];
    const alt = match[1] ?? '';
    const url = match[2] ?? '';
    if (url.length === 0) {
      continue;
    }
    if (full.includes(MARKDOWN_ATOM_CHAR)) {
      continue;
    }
    hits.push({ url, alt: alt.length > 0 ? alt : null });
  }
  return hits;
}

function buildBlockDecorations(node: PMNode, pos: number): Decoration[] {
  const hits = findEmbedHitsForBlock(node);
  if (hits.length === 0) {
    return [];
  }
  const widgetPos = pos + node.nodeSize;
  return hits.map((hit, index) =>
    Decoration.widget(
      widgetPos,
      () => {
        const { dom } = renderEmbedHost(hit.url, hit.alt, null);
        return dom;
      },
      {
        side: 1 + index,
        key: `embed:${hit.url}::${hit.alt ?? ''}`,
        ignoreSelection: true,
      },
    ),
  );
}

function buildAllDecorations(doc: PMNode): Decoration[] {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return;
    }
    if (node.type.spec.code) {
      return;
    }
    decorations.push(...buildBlockDecorations(node, pos));
    return false;
  });
  return decorations;
}

const embedPreviewKey = new PluginKey<DecorationSet>('embed-preview');

export function embedPreviewPlugin(): Plugin {
  return new Plugin({
    key: embedPreviewKey,
    state: {
      init(_, state) {
        return DecorationSet.create(state.doc, buildAllDecorations(state.doc));
      },
      apply(tr, prev) {
        if (!tr.docChanged) {
          return prev;
        }

        const changedRanges = getChangedRangesForTransaction(tr);
        if (changedRanges.length === 0) {
          return prev.map(tr.mapping, tr.doc);
        }

        const mapped = prev.map(tr.mapping, tr.doc);
        const changedBlocks = collectAffectedTextblocks(
          tr.doc,
          changedRanges,
          (node) => !node.type.spec.code,
        );
        if (changedBlocks.length === 0) {
          return mapped;
        }

        const toRemove = changedBlocks.flatMap(({ pos, node }) =>
          mapped.find(pos, pos + node.nodeSize + 1),
        );
        const next = toRemove.length > 0 ? mapped.remove(toRemove) : mapped;
        const toAdd = changedBlocks.flatMap(({ pos, node }) =>
          buildBlockDecorations(node, pos),
        );
        return toAdd.length > 0 ? next.add(tr.doc, toAdd) : next;
      },
    },
    props: {
      decorations(state) {
        return embedPreviewKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
