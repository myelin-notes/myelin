import type { MarkType, Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, Plugin } from 'prosemirror-state';
import { PM_ADD_TO_HISTORY } from '../constants';
import {
  buildResolvedTitleLookup,
  createTitleResolverView,
  type ResolveNoteLinkId,
} from './note-id-resolver';
import { parseInlineMarkdown } from './parse-inline';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from './range-tracking';
import { MARKDOWN_ATOM_CHAR } from './types';

export type { ResolveNoteLinkId };

interface TextOffsetMap {
  text: string;
  posAt: number[];
}

interface NoteLinkCoverage {
  title: string;
  noteId: string | null;
}

interface NoteLinkTarget {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  title: string;
  noteId: string | null;
}

const NOTE_LINK_SELECTOR = '[data-note-link-title]';

type NoteLinkElementLike = {
  closest(selector: string): NoteLinkElementLike | null;
  getAttribute(name: string): string | null;
};

function hasClosest(value: unknown): value is NoteLinkElementLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'closest' in value &&
    typeof (value as { closest?: unknown }).closest === 'function' &&
    'getAttribute' in value &&
    typeof (value as { getAttribute?: unknown }).getAttribute === 'function'
  );
}

function findNoteLinkElement(
  target: EventTarget | null,
): NoteLinkElementLike | null {
  if (hasClosest(target)) {
    return target.closest(NOTE_LINK_SELECTOR);
  }

  const parentElement =
    typeof target === 'object' && target !== null && 'parentElement' in target
      ? (target as { parentElement?: unknown }).parentElement
      : null;
  if (hasClosest(parentElement)) {
    return parentElement.closest(NOTE_LINK_SELECTOR);
  }

  return null;
}

function buildTextOffsetMap(node: PMNode, pos: number): TextOffsetMap {
  const parts: string[] = [];
  const posAt = [pos + 1];
  let cursorPos = pos + 1;

  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      parts.push(text);
      for (let i = 0; i < text.length; i++) {
        cursorPos += 1;
        posAt.push(cursorPos);
      }
      return;
    }

    parts.push(MARKDOWN_ATOM_CHAR);
    cursorPos += child.nodeSize;
    posAt.push(cursorPos);
  });

  return {
    text: parts.join(''),
    posAt,
  };
}

function sameCoverage(
  left: NoteLinkCoverage | null,
  right: NoteLinkCoverage | null,
): boolean {
  return (
    left?.title === right?.title &&
    (left?.noteId ?? null) === (right?.noteId ?? null)
  );
}

function buildCurrentNoteLinkCoverage(
  node: PMNode,
  noteLinkType: MarkType,
): Array<NoteLinkCoverage | null> {
  const coverage: Array<NoteLinkCoverage | null> = [];

  node.forEach((child) => {
    if (child.isText) {
      const noteLinkMark = child.marks.find(
        (candidate) => candidate.type === noteLinkType,
      );
      const value = noteLinkMark
        ? {
            title: noteLinkMark.attrs.title as string,
            noteId: (noteLinkMark.attrs.noteId as string | null) ?? null,
          }
        : null;

      for (let i = 0; i < (child.text?.length ?? 0); i++) {
        coverage.push(value);
      }
      return;
    }

    coverage.push(null);
  });

  return coverage;
}

function collectExistingNoteLinkIds(
  node: PMNode,
  noteLinkType: MarkType,
): Map<string, string | null> {
  const ids = new Map<string, string | null>();

  node.forEach((child) => {
    if (!child.isText) {
      return;
    }

    const mark = child.marks.find(
      (candidate) => candidate.type === noteLinkType,
    );
    if (!mark) {
      return;
    }

    const title = mark.attrs.title as string;
    if (!ids.has(title)) {
      ids.set(title, (mark.attrs.noteId as string | null) ?? null);
    }
  });

  return ids;
}

function collectNoteLinkTargets(
  node: PMNode,
  pos: number,
  schema: Schema,
): NoteLinkTarget[] {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return [];
  }

  const { text, posAt } = buildTextOffsetMap(node, pos);
  if (!text.includes('[[')) {
    return [];
  }

  const existingIds = collectExistingNoteLinkIds(node, noteLinkType);
  return parseInlineMarkdown(text)
    .ranges.filter((range) => range.kind === 'noteLink')
    .map((range) => {
      const title = text.slice(range.contentFrom, range.contentTo);
      return {
        from: posAt[range.open.from],
        to: posAt[range.close.to],
        textFrom: range.open.from,
        textTo: range.close.to,
        title,
        noteId: existingIds.get(title) ?? null,
      };
    });
}

function needsNoteLinkNormalization(
  node: PMNode,
  noteLinkType: MarkType,
  targets: readonly NoteLinkTarget[],
): boolean {
  const currentCoverage = buildCurrentNoteLinkCoverage(node, noteLinkType);
  const desiredCoverage = new Array<NoteLinkCoverage | null>(
    currentCoverage.length,
  ).fill(null);

  for (const target of targets) {
    const value = {
      title: target.title,
      noteId: target.noteId,
    };
    for (let index = target.textFrom; index < target.textTo; index++) {
      desiredCoverage[index] = value;
    }
  }

  if (currentCoverage.length !== desiredCoverage.length) {
    return true;
  }

  for (let i = 0; i < currentCoverage.length; i++) {
    if (!sameCoverage(currentCoverage[i], desiredCoverage[i])) {
      return true;
    }
  }

  return false;
}

function collectDocumentNoteLinks(
  doc: PMNode,
  schema: Schema,
): NoteLinkTarget[] {
  const targets: NoteLinkTarget[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.spec.code) {
      return true;
    }

    targets.push(...collectNoteLinkTargets(node, pos, schema));
    return false;
  });

  return targets;
}

function collectNormalizableTextblocks(
  doc: PMNode,
): Array<{ pos: number; node: PMNode }> {
  const targets: Array<{ pos: number; node: PMNode }> = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.spec.code) {
      return true;
    }

    targets.push({ pos, node });
    return false;
  });

  return targets;
}

export function buildNormalizedNoteLinkTransaction(
  state: EditorState,
  schema: Schema,
  changedTargets: Array<{
    pos: number;
    node: PMNode;
  }> = collectNormalizableTextblocks(state.doc),
) {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return null;
  }

  const tr = state.tr;
  let changed = false;

  for (const { pos, node } of changedTargets) {
    const targets = collectNoteLinkTargets(node, pos, schema);
    if (!needsNoteLinkNormalization(node, noteLinkType, targets)) {
      continue;
    }

    const contentFrom = pos + 1;
    const contentTo = contentFrom + node.content.size;
    tr.removeMark(contentFrom, contentTo, noteLinkType);

    for (const target of targets) {
      tr.addMark(
        target.from,
        target.to,
        noteLinkType.create({
          title: target.title,
          noteId: target.noteId,
        }),
      );
    }

    changed = true;
  }

  return changed ? tr : null;
}

function collectNoteLinkTitles(doc: PMNode, schema: Schema): string[] {
  return collectDocumentNoteLinks(doc, schema).map((target) => target.title);
}

export async function normalizeAndResolveNoteLinksDoc(
  doc: PMNode,
  schema: Schema,
  resolveNoteLinkId?: ResolveNoteLinkId,
): Promise<PMNode> {
  let state = EditorState.create({ schema, doc });

  const normalizeTr = buildNormalizedNoteLinkTransaction(state, schema);
  if (normalizeTr) {
    state = state.apply(normalizeTr);
  }

  if (!resolveNoteLinkId) {
    return state.doc;
  }

  const noteIdsByTitle = await buildResolvedTitleLookup(
    state.doc,
    schema,
    collectNoteLinkTitles,
    resolveNoteLinkId,
  );
  const resolveTr = buildResolvedNoteLinkTransaction(
    state,
    schema,
    noteIdsByTitle,
  );
  if (resolveTr) {
    state = state.apply(resolveTr);
  }

  return state.doc;
}

export function buildResolvedNoteLinkTransaction(
  state: EditorState,
  schema: Schema,
  noteIdsByTitle: ReadonlyMap<string, string | null>,
) {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return null;
  }

  const tr = state.tr;
  let changed = false;

  for (const target of collectDocumentNoteLinks(state.doc, schema)) {
    if (target.noteId !== null) {
      continue;
    }

    const resolvedNoteId = noteIdsByTitle.get(target.title) ?? null;
    if (resolvedNoteId === target.noteId) {
      continue;
    }

    tr.removeMark(target.from, target.to, noteLinkType);
    tr.addMark(
      target.from,
      target.to,
      noteLinkType.create({
        title: target.title,
        noteId: resolvedNoteId,
      }),
    );
    changed = true;
  }

  if (!changed) {
    return null;
  }

  tr.setMeta(PM_ADD_TO_HISTORY, false);
  return tr;
}

export function noteLinkMarkdownPlugin(
  schema: Schema,
  resolveNoteLinkId?: ResolveNoteLinkId,
): Plugin {
  return new Plugin({
    props: {
      handleClick(_view, _pos, event) {
        if (!event.metaKey && !event.ctrlKey) {
          return false;
        }

        const noteLinkElement = findNoteLinkElement(event.target);
        if (!noteLinkElement) {
          return false;
        }

        console.log(noteLinkElement.getAttribute('data-note-id'));
        return true;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      const changedRanges = getChangedRangesForTransactions(
        transactions,
        newState.doc.content.size,
      );
      if (changedRanges.length === 0) {
        return null;
      }

      const changedTargets = collectAffectedTextblocks(
        newState.doc,
        changedRanges,
        (node) => !node.type.spec.code,
      );
      if (changedTargets.length === 0) {
        return null;
      }

      return buildNormalizedNoteLinkTransaction(
        newState,
        schema,
        changedTargets,
      );
    },
    view(view) {
      return createTitleResolverView(view, {
        schema,
        collectTitles: collectNoteLinkTitles,
        buildResolveTransaction: buildResolvedNoteLinkTransaction,
        resolveNoteLinkId,
      });
    },
  });
}
