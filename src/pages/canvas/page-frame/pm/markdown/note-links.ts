import type { MarkType, Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, Plugin } from 'prosemirror-state';
import { NOTE_LINK_OPEN_REQUEST_EVENT } from '@/lib/events';
import type { VFSNodeId } from '@/lib/sync';
import { UserPrefs } from '@/lib/user-prefs';
import { PM_ADD_TO_HISTORY } from '../constants';
import {
  buildResolvedTitleLookup,
  createTitleResolverView,
  type NoteLinkRef,
  type ResolveNoteLink,
} from './note-id-resolver';
import { parseInlineMarkdown } from './parse-inline';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from './range-tracking';
import { MARKDOWN_ATOM_CHAR } from './types';

export type { NoteLinkRef, ResolveNoteLink };

interface TextOffsetMap {
  text: string;
  posAt: number[];
}

interface NoteLinkCoverage {
  title: string;
  noteId: VFSNodeId | null;
  pageFrameId: string | null;
}

interface NoteLinkTarget {
  from: number;
  to: number;
  textFrom: number;
  textTo: number;
  title: string;
  noteId: VFSNodeId | null;
  pageFrameId: string | null;
}

export interface RenameNoteLinkReferencesResult {
  doc: PMNode;
  count: number;
}

export const NOTE_LINK_SELECTOR = '[data-note-link-title]';

export interface NoteLinkOpenRequestDetail {
  title: string;
  noteId: VFSNodeId | null;
  pageFrameId: string | null;
}

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
    (left?.noteId ?? null) === (right?.noteId ?? null) &&
    (left?.pageFrameId ?? null) === (right?.pageFrameId ?? null)
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
            noteId: (noteLinkMark.attrs.noteId as VFSNodeId | null) ?? null,
            pageFrameId:
              (noteLinkMark.attrs.pageFrameId as string | null) ?? null,
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

function findExistingNoteLinkCoverage(
  coverage: readonly (NoteLinkCoverage | null)[],
  from: number,
  to: number,
  title: string,
): NoteLinkCoverage | null {
  let match: NoteLinkCoverage | null = null;

  for (let index = from; index < to; index++) {
    const value = coverage[index] ?? null;
    if (value?.title !== title) {
      return null;
    }

    if (match === null) {
      match = value;
      continue;
    }

    if (!sameCoverage(match, value)) {
      return null;
    }
  }

  return match;
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

  const currentCoverage = buildCurrentNoteLinkCoverage(node, noteLinkType);
  return parseInlineMarkdown(text)
    .ranges.filter((range) => range.kind === 'noteLink')
    .map((range) => {
      const title = text.slice(range.contentFrom, range.contentTo);
      const existingCoverage = findExistingNoteLinkCoverage(
        currentCoverage,
        range.open.from,
        range.close.to,
        title,
      );
      return {
        from: posAt[range.open.from],
        to: posAt[range.close.to],
        textFrom: range.open.from,
        textTo: range.close.to,
        title,
        noteId: existingCoverage?.noteId ?? null,
        pageFrameId: existingCoverage?.pageFrameId ?? null,
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
      pageFrameId: target.pageFrameId,
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
          pageFrameId: target.pageFrameId,
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
  resolveNoteLink?: ResolveNoteLink,
): Promise<PMNode> {
  let state = EditorState.create({ schema, doc });

  const normalizeTr = buildNormalizedNoteLinkTransaction(state, schema);
  if (normalizeTr) {
    state = state.apply(normalizeTr);
  }

  if (!resolveNoteLink) {
    return state.doc;
  }

  const refsByTitle = await buildResolvedTitleLookup(
    state.doc,
    schema,
    collectNoteLinkTitles,
    resolveNoteLink,
  );
  const resolveTr = buildResolvedNoteLinkTransaction(
    state,
    schema,
    refsByTitle,
  );
  if (resolveTr) {
    state = state.apply(resolveTr);
  }

  return state.doc;
}

export function buildResolvedNoteLinkTransaction(
  state: EditorState,
  schema: Schema,
  refsByTitle: ReadonlyMap<string, NoteLinkRef>,
) {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return null;
  }

  const tr = state.tr;
  let changed = false;

  for (const target of collectDocumentNoteLinks(state.doc, schema)) {
    const ref = refsByTitle.get(target.title);
    if (!ref) {
      continue;
    }

    // Treats stored uuids as stable: once a pageFrameId is set on a link
    // mark, we never overwrite it from a fresh resolution. A delete+recreate
    // of the target frame under a new uuid leaves a dead uuid here, but
    // canvas/index.tsx falls back to focusPageFrameByName so the link still
    // navigates correctly.
    const nextNoteId = target.noteId ?? ref.noteId;
    const nextPageFrameId = target.pageFrameId ?? ref.pageFrameId;
    if (
      nextNoteId === target.noteId &&
      nextPageFrameId === target.pageFrameId
    ) {
      continue;
    }

    tr.removeMark(target.from, target.to, noteLinkType);
    tr.addMark(
      target.from,
      target.to,
      noteLinkType.create({
        title: target.title,
        noteId: nextNoteId,
        pageFrameId: nextPageFrameId,
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

export function renameNoteLinkReferenceTitle(
  title: string,
  newName: string,
): string {
  const aliasIndex = title.indexOf('|');
  const target = aliasIndex === -1 ? title : title.slice(0, aliasIndex);
  const alias = aliasIndex === -1 ? '' : title.slice(aliasIndex);
  const frameIndex = target.indexOf('#');
  const noteTarget = frameIndex === -1 ? target : target.slice(0, frameIndex);
  const frame = frameIndex === -1 ? '' : target.slice(frameIndex);
  const pathSegments = noteTarget.split('/');
  pathSegments[pathSegments.length - 1] = newName;
  return `${pathSegments.join('/')}${frame}${alias}`;
}

export function renamePageFrameLinkReferenceTitle(
  title: string,
  newName: string,
): string {
  const aliasIndex = title.indexOf('|');
  const target = aliasIndex === -1 ? title : title.slice(0, aliasIndex);
  const alias = aliasIndex === -1 ? '' : title.slice(aliasIndex);
  const frameIndex = target.indexOf('#');
  if (frameIndex === -1) {
    return title;
  }
  const noteTarget = target.slice(0, frameIndex);
  return `${noteTarget}#${newName}${alias}`;
}

export interface RenamePageFrameLinkTransactionResult {
  tr: import('prosemirror-state').Transaction;
  count: number;
}

export function buildRenamePageFrameLinkReferencesTransaction(
  state: EditorState,
  schema: Schema,
  pageFrameId: string,
  newName: string,
): RenamePageFrameLinkTransactionResult | null {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return null;
  }

  const targets = collectDocumentNoteLinks(state.doc, schema)
    .filter((target) => target.pageFrameId === pageFrameId)
    .sort((left, right) => right.from - left.from);
  if (targets.length === 0) {
    return null;
  }

  const tr = state.tr;
  let count = 0;
  for (const target of targets) {
    const nextTitle = renamePageFrameLinkReferenceTitle(target.title, newName);
    if (nextTitle === target.title) {
      continue;
    }

    tr.replaceWith(
      target.from,
      target.to,
      schema.text(`[[${nextTitle}]]`, [
        noteLinkType.create({
          title: nextTitle,
          noteId: target.noteId,
          pageFrameId,
        }),
      ]),
    );
    count++;
  }

  return count > 0 ? { tr, count } : null;
}

export function renamePageFrameLinkReferencesDoc(
  doc: PMNode,
  schema: Schema,
  pageFrameId: string,
  newName: string,
): RenameNoteLinkReferencesResult {
  const state = EditorState.create({ schema, doc });
  const result = buildRenamePageFrameLinkReferencesTransaction(
    state,
    schema,
    pageFrameId,
    newName,
  );
  if (!result) {
    return { doc, count: 0 };
  }
  return { doc: state.apply(result.tr).doc, count: result.count };
}

export function renameNoteLinkReferencesDoc(
  doc: PMNode,
  schema: Schema,
  noteId: VFSNodeId,
  newName: string,
): RenameNoteLinkReferencesResult {
  const noteLinkType = schema.marks.noteLink;
  if (!noteLinkType) {
    return { doc, count: 0 };
  }

  const state = EditorState.create({ schema, doc });
  const targets = collectDocumentNoteLinks(state.doc, schema)
    .filter((target) => target.noteId === noteId)
    .sort((left, right) => right.from - left.from);
  if (targets.length === 0) {
    return { doc, count: 0 };
  }

  const tr = state.tr;
  let count = 0;
  for (const target of targets) {
    const nextTitle = renameNoteLinkReferenceTitle(target.title, newName);
    if (nextTitle === target.title) {
      continue;
    }

    tr.replaceWith(
      target.from,
      target.to,
      schema.text(`[[${nextTitle}]]`, [
        noteLinkType.create({
          title: nextTitle,
          noteId,
          pageFrameId: target.pageFrameId,
        }),
      ]),
    );
    count++;
  }

  if (count === 0) {
    return { doc, count: 0 };
  }

  return { doc: state.apply(tr).doc, count };
}

export function noteLinkMarkdownPlugin(
  schema: Schema,
  resolveNoteLink?: ResolveNoteLink,
): Plugin {
  return new Plugin({
    props: {
      handleClick(view, _pos, event) {
        if (
          UserPrefs.get('linkRequireModifier') &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          return false;
        }

        const noteLinkElement = findNoteLinkElement(event.target);
        if (!noteLinkElement) {
          return false;
        }

        const title = noteLinkElement.getAttribute('data-note-link-title');
        if (title === null) {
          return false;
        }

        event.preventDefault();
        view.dom.dispatchEvent(
          new CustomEvent<NoteLinkOpenRequestDetail>(
            NOTE_LINK_OPEN_REQUEST_EVENT,
            {
              detail: {
                title,
                noteId: noteLinkElement.getAttribute('data-note-id') || null,
                pageFrameId:
                  noteLinkElement.getAttribute('data-page-frame-id') || null,
              },
            },
          ),
        );
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
        resolveNoteLink,
      });
    },
  });
}
