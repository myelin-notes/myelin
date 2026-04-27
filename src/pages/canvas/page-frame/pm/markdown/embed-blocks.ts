import { Fragment, type Node as PMNode, type Schema } from 'prosemirror-model';
import {
  type Command,
  EditorState,
  NodeSelection,
  Plugin,
  TextSelection,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { PM_ADD_TO_HISTORY } from '../constants';
import {
  parseRawMarkdownMediaEmbed,
  parseRawNoteEmbed,
  serializeMarkdownMediaEmbed,
  serializeNoteEmbed,
} from './embeds';
import type { ResolveNoteLinkId } from './note-links';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from './range-tracking';

interface EmbedParagraphTarget {
  node: PMNode;
  pos: number;
}

interface NoteEmbedNodeTarget {
  node: PMNode;
  pos: number;
  title: string;
  noteId: string | null;
}

interface NormalizeEmbedTransactionOptions {
  appendParagraph?: boolean;
}

function isPlainTextParagraph(node: PMNode): boolean {
  if (node.type.name !== 'paragraph' || node.childCount === 0) {
    return false;
  }

  let hasText = false;
  let plain = true;
  node.forEach((child) => {
    if (!child.isText || child.marks.length > 0) {
      plain = false;
      return;
    }
    hasText = true;
  });
  return plain && hasText;
}

function isActivelyEditingBlock(
  state: EditorState,
  pos: number,
  node: PMNode,
): boolean {
  const from = pos + 1;
  const to = from + node.content.size;
  if (state.selection.empty) {
    const { head } = state.selection;
    return head > from && head < to;
  }
  return state.selection.from < to && state.selection.to > from;
}

function createNormalizedEmbedNode(
  text: string,
  schema: Schema,
): PMNode | null {
  const noteEmbed = parseRawNoteEmbed(text);
  if (noteEmbed) {
    return schema.nodes.noteEmbed.create({
      target: noteEmbed.target,
      title: noteEmbed.title,
      fragment: noteEmbed.fragment,
      noteId: noteEmbed.noteId,
      width: noteEmbed.width,
      height: noteEmbed.height,
    });
  }

  const mediaEmbed = parseRawMarkdownMediaEmbed(text);
  if (mediaEmbed) {
    return schema.nodes.mediaEmbed.create({
      src: mediaEmbed.src,
      alt: mediaEmbed.alt,
      title: mediaEmbed.title,
      kind: mediaEmbed.kind,
      width: mediaEmbed.width,
      height: mediaEmbed.height,
    });
  }

  return null;
}

function collectNormalizableParagraphs(
  changedTargets: readonly EmbedParagraphTarget[],
): EmbedParagraphTarget[] {
  return changedTargets.filter(
    ({ node }) =>
      node.isTextblock && !node.type.spec.code && isPlainTextParagraph(node),
  );
}

export function buildNormalizedEmbedTransaction(
  state: EditorState,
  schema: Schema,
  changedTargets: readonly EmbedParagraphTarget[],
  options: NormalizeEmbedTransactionOptions = {},
) {
  const tr = state.tr;
  let changed = false;
  const appendParagraph = options.appendParagraph ?? false;

  for (const { pos, node } of [
    ...collectNormalizableParagraphs(changedTargets),
  ].sort((left, right) => right.pos - left.pos)) {
    if (isActivelyEditingBlock(state, pos, node)) {
      continue;
    }

    const normalizedNode = createNormalizedEmbedNode(node.textContent, schema);
    if (!normalizedNode) {
      continue;
    }

    const $pos = state.doc.resolve(pos);
    const index = $pos.index();
    const replacementNodes = [normalizedNode];
    const nextSibling = $pos.parent.maybeChild(index + 1);

    if (appendParagraph && !nextSibling?.isTextblock) {
      const paragraph = schema.nodes.paragraph.createAndFill();
      if (paragraph) {
        replacementNodes.push(paragraph);
      }
    }

    const replacement = Fragment.fromArray(replacementNodes);
    if (!$pos.parent.canReplace(index, index + 1, replacement)) {
      continue;
    }

    tr.replaceWith(pos, pos + node.nodeSize, replacement);
    if (
      replacementNodes.length > 1 &&
      state.selection.empty &&
      state.selection.head >= pos + 1 &&
      state.selection.head <= pos + node.content.size
    ) {
      tr.setSelection(
        TextSelection.create(tr.doc, pos + normalizedNode.nodeSize + 1),
      );
    }
    changed = true;
  }

  return changed ? tr : null;
}

function collectDocumentNoteEmbeds(
  doc: PMNode,
  schema: Schema,
): NoteEmbedNodeTarget[] {
  const noteEmbedType = schema.nodes.noteEmbed;
  const targets: NoteEmbedNodeTarget[] = [];

  doc.descendants((node, pos) => {
    if (node.type !== noteEmbedType) {
      return true;
    }

    targets.push({
      pos,
      node,
      title: (node.attrs.title as string) ?? '',
      noteId: (node.attrs.noteId as string | null) ?? null,
    });
    return false;
  });

  return targets;
}

async function buildResolvedNoteEmbedLookup(
  doc: PMNode,
  schema: Schema,
  resolveNoteLinkId: ResolveNoteLinkId,
): Promise<Map<string, string | null>> {
  const titles = Array.from(
    new Set(
      collectDocumentNoteEmbeds(doc, schema)
        .map((target) => target.title.trim())
        .filter((title) => title.length > 0),
    ),
  );
  const noteIdsByTitle = new Map<string, string | null>();

  await Promise.all(
    titles.map(async (title) => {
      noteIdsByTitle.set(title, await resolveNoteLinkId(title));
    }),
  );

  return noteIdsByTitle;
}

export function buildResolvedNoteEmbedTransaction(
  state: EditorState,
  schema: Schema,
  noteIdsByTitle: ReadonlyMap<string, string | null>,
) {
  const noteEmbedType = schema.nodes.noteEmbed;
  const tr = state.tr;
  let changed = false;

  for (const target of collectDocumentNoteEmbeds(state.doc, schema)) {
    const resolvedNoteId = noteIdsByTitle.get(target.title) ?? null;
    if (resolvedNoteId === target.noteId) {
      continue;
    }

    tr.setNodeMarkup(target.pos, noteEmbedType, {
      ...target.node.attrs,
      noteId: resolvedNoteId,
    });
    changed = true;
  }

  if (!changed) {
    return null;
  }

  tr.setMeta(PM_ADD_TO_HISTORY, false);
  return tr;
}

export async function normalizeAndResolveNoteEmbedsDoc(
  doc: PMNode,
  schema: Schema,
  resolveNoteLinkId?: ResolveNoteLinkId,
): Promise<PMNode> {
  let state = EditorState.create({ schema, doc });

  const normalizeTr = buildNormalizedEmbedTransaction(
    state,
    schema,
    collectAffectedTextblocks(
      state.doc,
      [{ from: 0, to: state.doc.content.size }],
      (node) => !node.type.spec.code,
    ),
    { appendParagraph: false },
  );
  if (normalizeTr) {
    state = state.apply(normalizeTr);
  }

  if (!resolveNoteLinkId) {
    return state.doc;
  }

  const noteIdsByTitle = await buildResolvedNoteEmbedLookup(
    state.doc,
    schema,
    resolveNoteLinkId,
  );
  const resolveTr = buildResolvedNoteEmbedTransaction(
    state,
    schema,
    noteIdsByTitle,
  );
  if (resolveTr) {
    state = state.apply(resolveTr);
  }

  return state.doc;
}

class NoteEmbedResolverView {
  private destroyed = false;
  private lastDoc: PMNode;
  private requestId = 0;

  constructor(
    private view: EditorView,
    private readonly schema: Schema,
    private readonly resolveNoteLinkId?: ResolveNoteLinkId,
  ) {
    this.lastDoc = view.state.doc;
    void this.resolve();
  }

  update(view: EditorView): void {
    const docChanged = view.state.doc !== this.lastDoc;
    this.view = view;
    if (!docChanged) {
      return;
    }

    this.lastDoc = view.state.doc;
    void this.resolve();
  }

  destroy(): void {
    this.destroyed = true;
    this.requestId += 1;
  }

  private async resolve(): Promise<void> {
    if (!this.resolveNoteLinkId) {
      return;
    }

    const currentRequestId = ++this.requestId;
    const noteIdsByTitle = await buildResolvedNoteEmbedLookup(
      this.view.state.doc,
      this.schema,
      this.resolveNoteLinkId,
    );

    if (this.destroyed || currentRequestId !== this.requestId) {
      return;
    }

    const tr = buildResolvedNoteEmbedTransaction(
      this.view.state,
      this.schema,
      noteIdsByTitle,
    );
    if (tr) {
      this.view.dispatch(tr);
    }
  }
}

function buildRawEmbedParagraph(state: EditorState, rawText: string): PMNode {
  return state.schema.nodes.paragraph.create(null, state.schema.text(rawText));
}

export const expandMarkdownEmbedCommand: Command = (state, dispatch) => {
  if (!(state.selection instanceof NodeSelection)) {
    return false;
  }

  const node = state.selection.node;
  let rawText: string | null = null;
  let cursorOffset = 0;

  if (node.type === state.schema.nodes.noteEmbed) {
    rawText = serializeNoteEmbed({
      target: (node.attrs.target as string) ?? '',
      width: (node.attrs.width as number | null) ?? null,
      height: (node.attrs.height as number | null) ?? null,
    });
    cursorOffset = 3;
  } else if (node.type === state.schema.nodes.mediaEmbed) {
    rawText = serializeMarkdownMediaEmbed({
      src: (node.attrs.src as string) ?? '',
      alt: (node.attrs.alt as string | null) ?? null,
      width: (node.attrs.width as number | null) ?? null,
      height: (node.attrs.height as number | null) ?? null,
      title: (node.attrs.title as string | null) ?? null,
    });
    cursorOffset = Math.max(2, rawText.indexOf('](') + 2);
  }

  if (!rawText) {
    return false;
  }

  if (dispatch) {
    const { from, to } = state.selection;
    const tr = state.tr.replaceWith(
      from,
      to,
      buildRawEmbedParagraph(state, rawText),
    );
    tr.setSelection(TextSelection.create(tr.doc, from + 1 + cursorOffset));
    dispatch(tr);
  }

  return true;
};

export function embedMarkdownPlugin(
  schema: Schema,
  resolveNoteLinkId?: ResolveNoteLinkId,
): Plugin {
  return new Plugin({
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

      return buildNormalizedEmbedTransaction(newState, schema, changedTargets, {
        appendParagraph: true,
      });
    },
    view(view) {
      return new NoteEmbedResolverView(view, schema, resolveNoteLinkId);
    },
  });
}
