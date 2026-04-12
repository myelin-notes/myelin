import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';

export interface ChangedRange {
  from: number;
  to: number;
}

export interface TextblockTarget {
  pos: number;
  node: PMNode;
}

function clampPos(pos: number, docSize: number): number {
  return Math.max(0, Math.min(pos, docSize));
}

function pushMappedRanges(
  ranges: ChangedRange[],
  mapping: Mapping,
  suffixMapping: Mapping,
  docSize: number,
): void {
  for (let i = 0; i < mapping.maps.length; i++) {
    const stepMap = mapping.maps[i];
    const remainder = new Mapping();
    remainder.appendMapping(mapping.slice(i + 1));
    remainder.appendMapping(suffixMapping);

    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const mappedFrom = clampPos(remainder.map(newStart, -1), docSize);
      const mappedTo = clampPos(remainder.map(newEnd, 1), docSize);
      ranges.push({
        from: Math.min(mappedFrom, mappedTo),
        to: Math.max(mappedFrom, mappedTo),
      });
    });
  }
}

export function mergeChangedRanges(ranges: ChangedRange[]): ChangedRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: ChangedRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.from <= last.to + 1) {
      last.to = Math.max(last.to, current.to);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

export function getChangedRangesForTransaction(
  tr: Transaction,
): ChangedRange[] {
  if (!tr.docChanged) {
    return [];
  }

  const ranges: ChangedRange[] = [];
  pushMappedRanges(ranges, tr.mapping, new Mapping(), tr.doc.content.size);
  return mergeChangedRanges(ranges);
}

export function getChangedRangesForTransactions(
  transactions: readonly Transaction[],
  docSize: number,
): ChangedRange[] {
  const ranges: ChangedRange[] = [];

  for (let i = 0; i < transactions.length; i++) {
    const tr = transactions[i];
    if (!tr.docChanged) {
      continue;
    }

    const suffixMapping = new Mapping();
    for (let j = i + 1; j < transactions.length; j++) {
      suffixMapping.appendMapping(transactions[j].mapping);
    }

    pushMappedRanges(ranges, tr.mapping, suffixMapping, docSize);
  }

  return mergeChangedRanges(ranges);
}

function maybeAddContainingTextblock(
  doc: PMNode,
  pos: number,
  targets: Map<number, PMNode>,
  predicate: (node: PMNode) => boolean,
): void {
  const $pos = doc.resolve(clampPos(pos, doc.content.size));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (!node.isTextblock || !predicate(node)) {
      continue;
    }
    targets.set($pos.before(depth), node);
    return;
  }
}

export function collectAffectedTextblocks(
  doc: PMNode,
  ranges: readonly ChangedRange[],
  predicate: (node: PMNode) => boolean = () => true,
): TextblockTarget[] {
  const targets = new Map<number, PMNode>();

  for (const range of ranges) {
    const from = clampPos(range.from - 1, doc.content.size);
    const to = clampPos(range.to + 1, doc.content.size);

    doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock) {
        if (predicate(node)) {
          targets.set(pos, node);
        }
        return false;
      }
      return true;
    });

    maybeAddContainingTextblock(doc, range.from, targets, predicate);
    maybeAddContainingTextblock(doc, range.to, targets, predicate);
  }

  return [...targets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pos, node]) => ({ pos, node }));
}
