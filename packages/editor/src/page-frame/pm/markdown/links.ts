import type { Mark, MarkType, Node as PMNode, Schema } from 'prosemirror-model';
import {
  type Command,
  type EditorState,
  Plugin,
  TextSelection,
} from 'prosemirror-state';
import { getPlatform } from '../../../platform';
import { UserPrefs } from '../../../user-prefs';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from './range-tracking';
import { buildTextOffsetMap } from './text-offset-map';
import { MARKDOWN_ATOM_CHAR } from './types';

interface MarkdownLinkTarget {
  from: number;
  to: number;
  label: string;
  href: string;
  title: string | null;
}

interface LinkAroundSelection {
  from: number;
  to: number;
  label: string;
  href: string;
  title: string | null;
  marks: readonly Mark[];
  cursorOffset: number;
}

const RAW_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
const LINK_SELECTOR = 'a[href]';
const ABSOLUTE_URL_RE = /^[a-z][a-z\d+.-]*:/i;
const LOCAL_ADDRESS_RE =
  /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:]+\])(?::\d+)?(?:[/?#].*)?$/i;
const DOMAIN_LIKE_RE =
  /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,}(?::\d+)?(?:[/?#].*)?$/i;

type AnchorElementLike = {
  closest(selector: string): AnchorElementLike | null;
  getAttribute(name: string): string | null;
};

function hasClosest(value: unknown): value is AnchorElementLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'closest' in value &&
    typeof (value as { closest?: unknown }).closest === 'function' &&
    'getAttribute' in value &&
    typeof (value as { getAttribute?: unknown }).getAttribute === 'function'
  );
}

function findAnchorElement(
  target: EventTarget | null,
): AnchorElementLike | null {
  if (hasClosest(target)) {
    return target.closest(LINK_SELECTOR);
  }

  const parentElement =
    typeof target === 'object' && target !== null && 'parentElement' in target
      ? (target as { parentElement?: unknown }).parentElement
      : null;
  if (hasClosest(parentElement)) {
    return parentElement.closest(LINK_SELECTOR);
  }

  return null;
}

function getOpenableHref(href: string): string | null {
  const trimmedHref = href.trim();
  if (trimmedHref.length === 0) {
    return null;
  }

  if (LOCAL_ADDRESS_RE.test(trimmedHref)) {
    return `http://${trimmedHref}`;
  }

  if (ABSOLUTE_URL_RE.test(trimmedHref)) {
    return trimmedHref;
  }

  if (trimmedHref.startsWith('//')) {
    return `https:${trimmedHref}`;
  }

  if (DOMAIN_LIKE_RE.test(trimmedHref)) {
    return `https://${trimmedHref}`;
  }

  return null;
}

function findMarkdownLinkTargets(
  node: PMNode,
  pos: number,
): MarkdownLinkTarget[] {
  const { text, posAt } = buildTextOffsetMap(node, pos);
  if (!text.includes('[') || !text.includes('](')) {
    return [];
  }

  const targets: MarkdownLinkTarget[] = [];
  RAW_LINK_RE.lastIndex = 0;

  for (const match of text.matchAll(RAW_LINK_RE)) {
    const full = match[0];
    const label = match[1] ?? '';
    const href = match[2] ?? '';
    const title = match[3] ?? null;
    const start = match.index ?? -1;

    if (start < 0 || label.length === 0 || href.length === 0) {
      continue;
    }
    if (start > 0 && text[start - 1] === '!') {
      continue;
    }
    if (full.includes(MARKDOWN_ATOM_CHAR)) {
      continue;
    }

    const end = start + full.length;
    targets.push({
      from: posAt[start],
      to: posAt[end],
      label,
      href,
      title,
    });
  }

  return targets;
}

function collectReplacementMarks(
  state: EditorState,
  from: number,
  to: number,
  linkType: MarkType,
): readonly Mark[] {
  let marks: readonly Mark[] | null = null;

  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) {
      return;
    }

    const nextMarks = node.marks.filter((mark) => mark.type !== linkType);
    if (marks === null) {
      marks = nextMarks;
      return;
    }

    marks = marks.filter((mark) =>
      nextMarks.some((candidate) => candidate.eq(mark)),
    );
  });

  return marks ?? [];
}

function isActivelyEditingTarget(
  state: EditorState,
  target: MarkdownLinkTarget,
): boolean {
  if (state.selection.empty) {
    const { head } = state.selection;
    return head > target.from && head < target.to;
  }

  return state.selection.from < target.to && state.selection.to > target.from;
}

export function buildNormalizedLinkTransaction(
  state: EditorState,
  schema: Schema,
  changedTargets = collectAffectedTextblocks(
    state.doc,
    [{ from: 0, to: state.doc.content.size }],
    (node) => !node.type.spec.code,
  ),
) {
  const linkType = schema.marks.link;
  if (!linkType) {
    return null;
  }

  const replacements = changedTargets
    .flatMap(({ pos, node }) => findMarkdownLinkTargets(node, pos))
    .filter((target) => !isActivelyEditingTarget(state, target));
  if (replacements.length === 0) {
    return null;
  }

  const tr = state.tr;

  for (const target of [...replacements].sort(
    (left, right) => right.from - left.from,
  )) {
    const marks = collectReplacementMarks(
      state,
      target.from,
      target.to,
      linkType,
    );
    const textNode = schema.text(target.label, [
      ...marks,
      linkType.create({
        href: target.href,
        title: target.title,
      }),
    ]);
    tr.replaceWith(target.from, target.to, textNode);
  }

  return tr.docChanged ? tr : null;
}

function findLinkAroundSelection(
  state: EditorState,
  linkType: MarkType,
): LinkAroundSelection | null {
  if (!state.selection.empty) {
    return null;
  }

  const { $from } = state.selection;
  const parent = $from.parent;
  let childOffset = 0;

  for (let index = 0; index < parent.childCount; index++) {
    const child = parent.child(index);
    const childStart = childOffset;
    const childEnd = childStart + child.nodeSize;
    childOffset = childEnd;

    if (!child.isText) {
      continue;
    }

    const linkMark = child.marks.find((mark) => mark.type === linkType);
    if (!linkMark) {
      continue;
    }

    if ($from.parentOffset <= childStart || $from.parentOffset > childEnd) {
      continue;
    }

    let startIndex = index;
    let endIndex = index;
    let from = $from.start() + childStart;
    let to = $from.start() + childEnd;
    let label = child.text ?? '';
    const attrs = {
      href: linkMark.attrs.href as string,
      title: (linkMark.attrs.title as string | null) ?? null,
    };

    while (startIndex > 0) {
      const previous = parent.child(startIndex - 1);
      const previousMark = previous.isText
        ? previous.marks.find(
            (mark) =>
              mark.type === linkType &&
              mark.attrs.href === attrs.href &&
              ((mark.attrs.title as string | null) ?? null) === attrs.title,
          )
        : null;
      if (!previous.isText || !previousMark) {
        break;
      }
      startIndex -= 1;
      from -= previous.nodeSize;
      label = `${previous.text ?? ''}${label}`;
    }

    while (endIndex + 1 < parent.childCount) {
      const next = parent.child(endIndex + 1);
      const nextMark = next.isText
        ? next.marks.find(
            (mark) =>
              mark.type === linkType &&
              mark.attrs.href === attrs.href &&
              ((mark.attrs.title as string | null) ?? null) === attrs.title,
          )
        : null;
      if (!next.isText || !nextMark) {
        break;
      }
      endIndex += 1;
      to += next.nodeSize;
      label = `${label}${next.text ?? ''}`;
    }

    const marks = child.marks.filter((mark) => mark.type !== linkType);
    const cursorOffset = Math.max(
      0,
      Math.min(state.selection.head - from, label.length),
    );

    return {
      from,
      to,
      label,
      href: attrs.href,
      title: attrs.title,
      marks,
      cursorOffset,
    };
  }

  return null;
}

function buildRawMarkdownLinkText(link: LinkAroundSelection): string {
  const titleSuffix =
    typeof link.title === 'string' && link.title.length > 0
      ? ` "${link.title}"`
      : '';
  return `[${link.label}](${link.href}${titleSuffix})`;
}

export const expandMarkdownLinkCommand: Command = (state, dispatch) => {
  const linkType = state.schema.marks.link;
  if (!linkType) {
    return false;
  }

  const link = findLinkAroundSelection(state, linkType);
  if (!link) {
    return false;
  }

  if (dispatch) {
    const rawText = buildRawMarkdownLinkText(link);
    const tr = state.tr.replaceWith(
      link.from,
      link.to,
      state.schema.text(rawText, link.marks),
    );
    tr.setSelection(
      TextSelection.create(tr.doc, link.from + 1 + link.cursorOffset),
    );
    dispatch(tr);
  }

  return true;
};

function handleModifiedLinkInteraction(event: MouseEvent): boolean {
  if (
    UserPrefs.get('linkRequireModifier') &&
    !event.metaKey &&
    !event.ctrlKey
  ) {
    return false;
  }

  const anchor = findAnchorElement(event.target);
  const href = anchor?.getAttribute('href');
  const openableHref = href ? getOpenableHref(href) : null;
  if (!openableHref) {
    return false;
  }

  event.preventDefault();
  void getPlatform().openExternal(openableHref);
  return true;
}

export function linkMarkdownPlugin(schema: Schema): Plugin {
  return new Plugin({
    props: {
      handleClick(_view, _pos, event) {
        return handleModifiedLinkInteraction(event);
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

      return buildNormalizedLinkTransaction(newState, schema, changedTargets);
    },
    view(_view) {
      return {
        update(nextView, previousState) {
          if (
            nextView.state.doc === previousState.doc &&
            nextView.state.selection.eq(previousState.selection)
          ) {
            return;
          }

          const tr = buildNormalizedLinkTransaction(nextView.state, schema);
          if (tr) {
            nextView.dispatch(tr);
          }
        },
      };
    },
  });
}
