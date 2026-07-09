import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { type ResolveMediaSrc, renderEmbedHost } from '../embed/renderer';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransaction,
} from './range-tracking';
import { buildTextOffsetMap } from './text-offset-map';
import { MARKDOWN_ATOM_CHAR } from './types';

// The URL runs up to the closing paren (spaces allowed, e.g. library paths
// like `/My Pics/cat.png`); it's trimmed when collected.
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g;

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
    const url = (match[2] ?? '').trim();
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

function embedKey(hit: EmbedHit): string {
  return `embed:${hit.url}::${hit.alt ?? ''}`;
}

const embedHostDestroyers = new WeakMap<Node, () => void>();

function buildBlockDecorations(
  node: PMNode,
  pos: number,
  resolveMedia?: ResolveMediaSrc,
): Decoration[] {
  const hits = findEmbedHitsForBlock(node);
  if (hits.length === 0) {
    return [];
  }
  const widgetPos = pos + node.nodeSize;
  return hits.map((hit, index) =>
    Decoration.widget(
      widgetPos,
      () => {
        const { dom, destroy } = renderEmbedHost(
          hit.url,
          hit.alt,
          null,
          resolveMedia,
        );
        embedHostDestroyers.set(dom, destroy);
        return dom;
      },
      {
        side: -1 - index,
        key: embedKey(hit),
        ignoreSelection: true,
        destroy: (dom) => {
          const destroy = embedHostDestroyers.get(dom);
          if (destroy) {
            embedHostDestroyers.delete(dom);
            destroy();
          }
        },
      },
    ),
  );
}

function embedDecorationsAt(
  set: DecorationSet,
  widgetPos: number,
): Decoration[] {
  return set.find(widgetPos, widgetPos).filter((d) => {
    const key = (d.spec as { key?: unknown } | undefined)?.key;
    return typeof key === 'string' && key.startsWith('embed:');
  });
}

function sameKeySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) {
      return false;
    }
  }
  return true;
}

function buildAllDecorations(
  doc: PMNode,
  resolveMedia?: ResolveMediaSrc,
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return;
    }
    if (node.type.spec.code) {
      return;
    }
    decorations.push(...buildBlockDecorations(node, pos, resolveMedia));
    return false;
  });
  return decorations;
}

const embedPreviewKey = new PluginKey<DecorationSet>('embed-preview');

export function embedPreviewPlugin(resolveMedia?: ResolveMediaSrc): Plugin {
  return new Plugin({
    key: embedPreviewKey,
    state: {
      init(_, state) {
        return DecorationSet.create(
          state.doc,
          buildAllDecorations(state.doc, resolveMedia),
        );
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

        const toRemove: Decoration[] = [];
        const toAdd: Decoration[] = [];
        for (const { pos, node } of changedBlocks) {
          const widgetPos = pos + node.nodeSize;
          const desiredKeys = findEmbedHitsForBlock(node).map(embedKey);
          const existing = embedDecorationsAt(mapped, widgetPos);
          const existingKeys = existing.map(
            (d) => (d.spec as { key: string }).key,
          );
          if (sameKeySet(existingKeys, desiredKeys)) {
            continue;
          }
          toRemove.push(...existing);
          toAdd.push(...buildBlockDecorations(node, pos, resolveMedia));
        }
        const next = toRemove.length > 0 ? mapped.remove(toRemove) : mapped;
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
