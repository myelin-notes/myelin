import type { Schema } from 'prosemirror-model';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type {
  PageFrameAutocompleteItem,
  PageFrameAutocompleteRange,
  PageFrameAutocompleteRequest,
} from './autocomplete';
import { MARKDOWN_ATOM_CHAR } from './markdown/types';
import { createTableNode, setSelectionInsideTableCell } from './table-commands';

interface TextOffsetMap {
  text: string;
  posAt: number[];
}

type SlashInsertAction =
  | {
      kind: 'block';
      nodeType:
        | 'heading'
        | 'paragraph'
        | 'blockquote'
        | 'bulletListItem'
        | 'orderedListItem';
      attrs?: Record<string, number>;
    }
  | {
      kind: 'inline';
      open: string;
      close: string;
    }
  | {
      kind: 'table';
      rows: number;
      columns: number;
    };

export interface SlashInsertAutocompleteItem extends PageFrameAutocompleteItem {
  slashAction: SlashInsertAction;
  keywords: readonly string[];
}

export interface ActiveSlashInsertAutocomplete
  extends PageFrameAutocompleteRequest {
  replaceRange: PageFrameAutocompleteRange;
}

const SLASH_INSERT_ITEMS: readonly SlashInsertAutocompleteItem[] = [
  {
    id: 'slash-heading-1',
    title: 'Heading 1',
    subtitle: 'Turn this block into a top-level heading',
    detail: '#',
    keywords: ['heading', 'h1', 'title', '#'],
    slashAction: {
      kind: 'block',
      nodeType: 'heading',
      attrs: { level: 1 },
    },
  },
  {
    id: 'slash-heading-2',
    title: 'Heading 2',
    subtitle: 'Turn this block into a section heading',
    detail: '##',
    keywords: ['heading', 'h2', 'section', '##'],
    slashAction: {
      kind: 'block',
      nodeType: 'heading',
      attrs: { level: 2 },
    },
  },
  {
    id: 'slash-heading-3',
    title: 'Heading 3',
    subtitle: 'Turn this block into a small heading',
    detail: '###',
    keywords: ['heading', 'h3', 'subheading', '###'],
    slashAction: {
      kind: 'block',
      nodeType: 'heading',
      attrs: { level: 3 },
    },
  },
  {
    id: 'slash-quote',
    title: 'Quote',
    subtitle: 'Turn this block into a blockquote',
    detail: '>',
    keywords: ['quote', 'blockquote', '>'],
    slashAction: {
      kind: 'block',
      nodeType: 'blockquote',
    },
  },
  {
    id: 'slash-bullet-list',
    title: 'Bullet list',
    subtitle: 'Turn this block into a bulleted list item',
    detail: '-',
    keywords: ['bullet', 'list', 'unordered', '-', '*'],
    slashAction: {
      kind: 'block',
      nodeType: 'bulletListItem',
      attrs: { indent: 0 },
    },
  },
  {
    id: 'slash-numbered-list',
    title: 'Numbered list',
    subtitle: 'Turn this block into a numbered list item',
    detail: '1.',
    keywords: ['numbered', 'ordered', 'list', '1.'],
    slashAction: {
      kind: 'block',
      nodeType: 'orderedListItem',
      attrs: { order: 1, indent: 0 },
    },
  },
  {
    id: 'slash-paragraph',
    title: 'Paragraph',
    subtitle: 'Reset this block back to plain body text',
    detail: 'P',
    keywords: ['paragraph', 'text', 'body', 'plain'],
    slashAction: {
      kind: 'block',
      nodeType: 'paragraph',
    },
  },
  {
    id: 'slash-table',
    title: 'Table',
    subtitle: 'Insert a table with header and body rows',
    detail: '2x2',
    keywords: ['table', 'grid', 'rows', 'columns'],
    slashAction: {
      kind: 'table',
      rows: 2,
      columns: 2,
    },
  },
  {
    id: 'slash-bold',
    title: 'Bold',
    subtitle: 'Insert **bold** markdown',
    detail: '**',
    keywords: ['bold', 'strong', '**'],
    slashAction: {
      kind: 'inline',
      open: '**',
      close: '**',
    },
  },
  {
    id: 'slash-italic',
    title: 'Italic',
    subtitle: 'Insert *italic* markdown',
    detail: '*',
    keywords: ['italic', 'emphasis', 'em', '*'],
    slashAction: {
      kind: 'inline',
      open: '*',
      close: '*',
    },
  },
  {
    id: 'slash-link',
    title: 'Link',
    subtitle: 'Insert [label](url) markdown',
    detail: '[]()',
    keywords: ['link', 'url', 'hyperlink', '[]()'],
    slashAction: {
      kind: 'inline',
      open: '[',
      close: ']()',
    },
  },
  {
    id: 'slash-inline-code',
    title: 'Inline code',
    subtitle: 'Insert `code` markdown',
    detail: '`',
    keywords: ['code', 'inline', '`'],
    slashAction: {
      kind: 'inline',
      open: '`',
      close: '`',
    },
  },
];

function buildTextOffsetMap(
  node: EditorState['selection']['$from']['parent'],
  pos: number,
): TextOffsetMap {
  const parts: string[] = [];
  const posAt = [pos + 1];
  let cursorPos = pos + 1;

  node.forEach((child) => {
    if (child.isText) {
      const text = child.text ?? '';
      parts.push(text);
      for (let index = 0; index < text.length; index++) {
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

function matchesSlashQuery(
  item: SlashInsertAutocompleteItem,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) {
    return true;
  }

  const searchable = [item.title, item.subtitle ?? '', ...item.keywords]
    .join(' ')
    .toLowerCase();
  return searchable.includes(normalizedQuery);
}

export function searchSlashInsertAutocompleteItems(
  query: string,
  limit: number,
): readonly SlashInsertAutocompleteItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return SLASH_INSERT_ITEMS.filter((item) =>
    matchesSlashQuery(item, normalizedQuery),
  ).slice(0, limit);
}

export function findActiveSlashInsertAutocomplete(
  state: EditorState,
): ActiveSlashInsertAutocomplete | null {
  if (!state.selection.empty || state.selection.$from.parent.type.spec.code) {
    return null;
  }

  const parent = state.selection.$from.parent;
  const parentPos = state.selection.$from.before();
  const { text, posAt } = buildTextOffsetMap(parent, parentPos);
  const cursorOffset = posAt.indexOf(state.selection.head);

  if (cursorOffset === -1 || text.includes(MARKDOWN_ATOM_CHAR)) {
    return null;
  }

  if (!text.startsWith('/')) {
    return null;
  }

  const commandText = text.trimEnd();
  if (commandText.length === 0 || commandText === '/') {
    return {
      query: '',
      range: {
        from: posAt[1],
        to: posAt[1],
      },
      replaceRange: {
        from: posAt[0],
        to: posAt[text.length],
      },
      anchorPosition: state.selection.head,
    };
  }

  if (!commandText.startsWith('/')) {
    return null;
  }

  if (cursorOffset < 1) {
    return null;
  }

  return {
    query: commandText.slice(1),
    range: {
      from: posAt[1],
      to: posAt[commandText.length],
    },
    replaceRange: {
      from: posAt[0],
      to: posAt[text.length],
    },
    anchorPosition: state.selection.head,
  };
}

export function isSlashInsertAutocompleteItem(
  item: PageFrameAutocompleteItem,
): item is SlashInsertAutocompleteItem {
  return 'slashAction' in item;
}

export function buildSelectSlashInsertAutocompleteTransaction(
  state: EditorState,
  schema: Schema,
  activeRequest: ActiveSlashInsertAutocomplete,
  item: PageFrameAutocompleteItem,
): Transaction | null {
  if (!isSlashInsertAutocompleteItem(item)) {
    return null;
  }

  const { slashAction } = item;

  if (slashAction.kind === 'inline') {
    const text = `${slashAction.open}${slashAction.close}`;
    const { from, to } = activeRequest.replaceRange;
    const tr = state.tr.insertText(text, from, to);
    tr.setSelection(
      TextSelection.create(tr.doc, from + slashAction.open.length),
    );
    return tr;
  }

  if (slashAction.kind === 'table') {
    const tableNode = createTableNode(
      schema,
      slashAction.rows,
      slashAction.columns,
    );
    const blockDepth = state.selection.$from.depth;
    const containerDepth = blockDepth - 1;
    const containerNode = state.selection.$from.node(containerDepth);
    const indexInContainer = state.selection.$from.index(containerDepth);

    if (
      containerDepth < 0 ||
      !containerNode.canReplaceWith(
        indexInContainer,
        indexInContainer + 1,
        tableNode.type,
      )
    ) {
      return null;
    }

    const blockPos = state.selection.$from.before();
    const blockNode = state.selection.$from.parent;
    const tr = state.tr.replaceWith(
      blockPos,
      blockPos + blockNode.nodeSize,
      tableNode,
    );

    return setSelectionInsideTableCell(tr, blockPos, 0, 0);
  }

  const nodeType = schema.nodes[slashAction.nodeType];
  if (!nodeType) {
    return null;
  }

  const blockPos = state.selection.$from.before();
  const tr = state.tr.delete(
    activeRequest.replaceRange.from,
    activeRequest.replaceRange.to,
  );
  const mappedBlockPos = tr.mapping.map(blockPos, -1);

  tr.setNodeMarkup(mappedBlockPos, nodeType, slashAction.attrs ?? null);
  tr.setSelection(TextSelection.create(tr.doc, mappedBlockPos + 1));
  return tr;
}
