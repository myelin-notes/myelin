import type { Schema } from 'prosemirror-model';
import {
  type EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type { Messages } from '@/lib/i18n';
import { MARKDOWN_ATOM_CHAR } from '../markdown/types';
import {
  createTableNode,
  setSelectionInsideTableCell,
} from '../table/commands';
import type {
  PageFrameAutocompleteItem,
  PageFrameAutocompleteRange,
  PageFrameAutocompleteRequest,
} from './index';

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
        | 'orderedListItem'
        | 'checkListItem';
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
    }
  | {
      kind: 'date';
      offsetDays: number;
      includeTime: boolean;
    };

export interface SlashInsertAutocompleteItem extends PageFrameAutocompleteItem {
  slashAction: SlashInsertAction;
  keywords: readonly string[];
}

export interface ActiveSlashInsertAutocomplete
  extends PageFrameAutocompleteRequest {
  replaceRange: PageFrameAutocompleteRange;
}

export type SlashInsertLabels = Messages['canvas']['slashInsert'];

// Title and subtitle live in the message catalogs (keyed by labelKey) so the
// menu follows the active language; everything here is language-independent.
interface SlashInsertItemDefinition {
  id: string;
  labelKey: keyof SlashInsertLabels;
  detail?: string;
  keywords: readonly string[];
  slashAction: SlashInsertAction;
}

// Formats a date action in the user's locale. Used both for the inserted text
// and for the live preview shown in the menu's detail chip.
export function formatSlashDate(
  action: Extract<SlashInsertAction, { kind: 'date' }>,
): string {
  const date = new Date();
  date.setDate(date.getDate() + action.offsetDays);
  const options: Intl.DateTimeFormatOptions = action.includeTime
    ? { dateStyle: 'long', timeStyle: 'short' }
    : { dateStyle: 'long' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

const SLASH_INSERT_DEFINITIONS: readonly SlashInsertItemDefinition[] = [
  {
    id: 'slash-heading-1',
    labelKey: 'heading1',
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
    labelKey: 'heading2',
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
    labelKey: 'heading3',
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
    labelKey: 'quote',
    detail: '>',
    keywords: ['quote', 'blockquote', '>'],
    slashAction: {
      kind: 'block',
      nodeType: 'blockquote',
    },
  },
  {
    id: 'slash-bullet-list',
    labelKey: 'bulletList',
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
    labelKey: 'numberedList',
    detail: '1.',
    keywords: ['numbered', 'ordered', 'list', '1.'],
    slashAction: {
      kind: 'block',
      nodeType: 'orderedListItem',
      attrs: { order: 1, indent: 0 },
    },
  },
  {
    id: 'slash-checklist',
    labelKey: 'todo',
    detail: '[ ]',
    keywords: [
      'todo',
      'to-do',
      'task',
      'checkbox',
      'checklist',
      'checkmark',
      'check',
      '[]',
      '[ ]',
    ],
    slashAction: {
      kind: 'block',
      nodeType: 'checkListItem',
    },
  },
  {
    id: 'slash-paragraph',
    labelKey: 'paragraph',
    detail: 'P',
    keywords: ['paragraph', 'text', 'body', 'plain'],
    slashAction: {
      kind: 'block',
      nodeType: 'paragraph',
    },
  },
  {
    id: 'slash-table',
    labelKey: 'table',
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
    labelKey: 'bold',
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
    labelKey: 'italic',
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
    labelKey: 'link',
    detail: '[]()',
    keywords: ['link', 'url', 'hyperlink', '[]()'],
    slashAction: {
      kind: 'inline',
      open: '[',
      close: ']()',
    },
  },
  {
    id: 'slash-note-link',
    labelKey: 'noteLink',
    detail: '[[]]',
    keywords: ['note', 'link', 'wiki', 'reference', 'backlink', '[[]]'],
    slashAction: {
      kind: 'inline',
      open: '[[',
      close: ']]',
    },
  },
  {
    id: 'slash-inline-code',
    labelKey: 'inlineCode',
    detail: '`',
    keywords: ['code', 'inline', '`'],
    slashAction: {
      kind: 'inline',
      open: '`',
      close: '`',
    },
  },
  {
    id: 'slash-embed',
    labelKey: 'embed',
    detail: '![]',
    keywords: [
      'embed',
      'image',
      'img',
      'photo',
      'video',
      'youtube',
      'vimeo',
      'link',
      '![]',
    ],
    slashAction: {
      kind: 'inline',
      open: '![',
      close: ']()',
    },
  },
  {
    id: 'slash-date-today',
    labelKey: 'today',
    keywords: ['date', 'today', 'now', 'current'],
    slashAction: { kind: 'date', offsetDays: 0, includeTime: false },
  },
  {
    id: 'slash-date-tomorrow',
    labelKey: 'tomorrow',
    keywords: ['date', 'tomorrow', 'next'],
    slashAction: { kind: 'date', offsetDays: 1, includeTime: false },
  },
  {
    id: 'slash-date-yesterday',
    labelKey: 'yesterday',
    keywords: ['date', 'yesterday', 'previous', 'last'],
    slashAction: { kind: 'date', offsetDays: -1, includeTime: false },
  },
  {
    id: 'slash-date-now',
    labelKey: 'now',
    keywords: ['date', 'time', 'now', 'timestamp', 'current'],
    slashAction: { kind: 'date', offsetDays: 0, includeTime: true },
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

function buildSlashInsertItem(
  definition: SlashInsertItemDefinition,
  labels: SlashInsertLabels,
): SlashInsertAutocompleteItem {
  const label = labels[definition.labelKey];
  return {
    id: definition.id,
    title: label.title,
    subtitle: label.subtitle,
    detail:
      definition.slashAction.kind === 'date'
        ? formatSlashDate(definition.slashAction)
        : definition.detail,
    keywords: definition.keywords,
    slashAction: definition.slashAction,
  };
}

export function searchSlashInsertAutocompleteItems(
  query: string,
  labels: SlashInsertLabels,
): readonly SlashInsertAutocompleteItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return SLASH_INSERT_DEFINITIONS.map((definition) =>
    buildSlashInsertItem(definition, labels),
  ).filter((item) => matchesSlashQuery(item, normalizedQuery));
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

  if (slashAction.kind === 'date') {
    const text = formatSlashDate(slashAction);
    const { from, to } = activeRequest.replaceRange;
    const tr = state.tr.insertText(text, from, to);
    tr.setSelection(TextSelection.create(tr.doc, from + text.length));
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
