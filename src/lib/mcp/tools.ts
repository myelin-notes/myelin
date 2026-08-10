import { ElementType } from '@myelin/editor/elements/element-type';
import {
  addMarkdownPageFrameToYDoc,
  DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET,
  writeMarkdownToPageFrameFragment,
} from '@myelin/editor/page-frame/markdown/import';
import { createBlankCanvasFile } from '@/lib/note/create';
import type {
  NodeSearchResult,
  NoteBacklink,
  NoteSession,
  ReadableRepository,
  Repository,
  StoredNoteLink,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  VFSNodeId,
} from '@/lib/sync';
import { extractStoredNoteLinks } from '@/lib/sync/repo/note-link-index';
import {
  type RenameNoteReferencesResult,
  renameNoteReferences,
} from '@/lib/sync/repo/rename-note-references';
import {
  buildMcpNoteReadModel,
  findElementMap,
  loadMcpNote,
  readMcpCanvasText,
  readMcpImage,
  readMcpLatex,
  readMcpNoteFull,
  readMcpPageFrame,
  readMcpPdf,
} from './read-model';
import type {
  McpDirectoryListing,
  McpFileListItem,
  McpFolderListItem,
  McpNodeListItem,
  McpNoteListItem,
  McpPageFrameContent,
  McpToolDefinition,
} from './types';

type ToolHandler = (args: unknown) => Promise<unknown>;
type CanvasNoteSearchResult = NodeSearchResult & { node: VFSFileNode };

const DEFAULT_NOTE_LIMIT = 50;
const CREATE_FRAME_OFFSET_STEP = 48;

function objectArg(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {};
  }
  return args as Record<string, unknown>;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

// Unlike requiredString, allows the empty string (e.g. clearing a frame).
function requiredText(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function requiredTrimmedString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(args, key).trim();
  if (!value) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (!(key in args)) {
    return undefined;
  }
  const value = args[key];
  if (!Array.isArray(value)) {
    throw new Error(`Expected string array argument: ${key}`);
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`Expected string array argument: ${key}`);
    }
    return item;
  });
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalLimit(args: Record<string, unknown>): number {
  const limit = optionalNumber(args, 'limit');
  if (!limit) {
    return DEFAULT_NOTE_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(limit), 200));
}

function textSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function stringArraySchema(description: string): Record<string, unknown> {
  return { type: 'array', items: { type: 'string' }, description };
}

const NOTE_ID_PROPERTY = {
  type: 'string',
  description:
    'Canvas note id (a UUID), taken from the "id" field returned by list_notes, search_notes, list_recent_notes, or list_directory. Titles and paths are not accepted; resolve a title with search_notes first.',
};

const PAGE_FRAME_ID_PROPERTY = {
  type: 'string',
  description:
    'Page frame id, from an element with kind "page-frame" in the "elements" array returned by read_note.',
};

function elementIdProperty(kind: string): Record<string, unknown> {
  return {
    type: 'string',
    description: `Element id, from an element with kind "${kind}" in the "elements" array returned by read_note. Passing an element of a different kind is an error.`,
  };
}

const LIMIT_PROPERTY = {
  type: 'number',
  description: 'Maximum results to return. Defaults to 50, clamped to 1-200.',
};

const TAG_FILTER_PROPERTY = {
  type: 'string',
  description:
    'Keep only results carrying exactly this tag. Matching is exact rather than hierarchical, so a note tagged "work/q3" is not returned for tag "work". Call list_tags to see the tags actually in use.',
};

const PARENT_FOLDER_PROPERTY = {
  type: 'string',
  description:
    'Id of the containing folder, from list_directory. Omit to use the repository root.',
};

const MARKDOWN_PROPERTY = {
  type: 'string',
  description:
    'Page frame body as Markdown. Supported: ATX headings, paragraphs, "- " and "1. " lists (indent nested items by two spaces), "- [ ]" / "- [x]" tasks, blockquotes and "> [!note]" callouts, fenced code blocks, "$$" math blocks and "$...$" inline math, pipe tables, "---" rules, **bold**, *italic*, <u>underline</u>, ~~strikethrough~~, `code`, [links](url), and wiki-style "[[Note Title]]" or "[[Note Title#Page Frame]]" links to other Myelin notes (resolved against note titles at import time). Anything else is imported as plain text.',
};

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'list_notes',
    description:
      "Browse the user's Myelin canvas notes, returning id, title, folder path, tags, timestamps, and a ~500 character preview of indexed text for each. Use this to discover what exists; use search_notes when you have specific terms to look for. Only canvas notes (.mcanvas) are listed - call list_directory to see other file types. Result order is unspecified, so treat a truncated result as an arbitrary subset rather than the top matches.",
    inputSchema: textSchema({
      query: {
        type: 'string',
        description:
          'Optional keyword filter over note titles and indexed content. When set, results come back relevance-ranked and folderId/tag are applied on top; when omitted, notes are collected by walking the folder tree.',
      },
      folderId: {
        type: 'string',
        description:
          'Restrict to notes anywhere beneath this folder (recursive, not just direct children). Omit for the whole repository.',
      },
      tag: TAG_FILTER_PROPERTY,
      limit: LIMIT_PROPERTY,
    }),
  },
  {
    name: 'search_notes',
    description:
      'Keyword search across canvas note titles and indexed body text, returning matches ranked by relevance with a score, the terms that matched, and a snippet showing the match in context. Prefer this over list_notes whenever you know what you are looking for. Matching is lexical, not semantic, so retry with synonyms or a shorter query if nothing comes back. Follow up with read_note or read_note_full on a promising match to get its actual content.',
    inputSchema: textSchema(
      {
        query: {
          type: 'string',
          description:
            'Search terms matched against note titles and indexed body text.',
        },
        tag: TAG_FILTER_PROPERTY,
        limit: LIMIT_PROPERTY,
      },
      ['query'],
    ),
  },
  {
    name: 'list_recent_notes',
    description:
      'List canvas notes ordered by most recently modified. Use this to answer "what has the user been working on" or to pick up where a previous session left off.',
    inputSchema: textSchema({
      limit: LIMIT_PROPERTY,
    }),
  },
  {
    name: 'list_tags',
    description:
      'List every tag in use with the number of nodes carrying it, most used first. Tags are hierarchical, written with "/" (for example "work/q3/planning"). Call this before filtering by tag anywhere else, because the tag filters match exactly and will silently return nothing for a tag that does not exist verbatim.',
    inputSchema: textSchema({
      includeAncestors: {
        type: 'boolean',
        description:
          'When true, also report each parent segment of a hierarchical tag as its own entry, counting every node tagged beneath it - so "work/q3" contributes to "work" as well. Defaults to false, which reports only tags exactly as stored.',
      },
    }),
  },
  {
    name: 'list_directory',
    description:
      'List the direct children of one folder: subfolders (with child counts) and files of every type, not just canvas notes. Use this to explore how the user organizes their vault, or to resolve a folder id before creating or moving something. Not recursive - call again on each subfolder to go deeper.',
    inputSchema: textSchema({
      folderId: {
        type: 'string',
        description:
          'Folder to list. Omit for the repository root. Ids come from the "folders" array of a previous list_directory call, or from the "parentId" of any node.',
      },
    }),
  },
  {
    name: 'read_note',
    description:
      'Read the structure of one canvas note: its metadata plus an inventory of every element on the canvas. A Myelin note is an infinite 2D canvas, and each element carries a "kind" (page-frame, text, latex, image, pdf, stroke), an id, and pixel bounds {x, y, width, height} with y increasing downward. Page frames hold the rich text and are the only writable content; text and latex float directly on the canvas; strokes are handwritten ink whose content is not readable. Only snippets are included here - each element names the follow-up tool in its "reader" field, or call read_note_full to get every text body in one shot. Use this first when you need to locate or modify something specific inside a note.',
    inputSchema: textSchema({ noteId: NOTE_ID_PROPERTY }, ['noteId']),
  },
  {
    name: 'read_links',
    description:
      'List the wiki-style "[[...]]" links written inside one canvas note, with each link\'s surrounding snippet and the resolved target note when it exists. Use this to traverse the note graph outward. A link whose targetExists is false points at a note the user has not created yet.',
    inputSchema: textSchema({ noteId: NOTE_ID_PROPERTY }, ['noteId']),
  },
  {
    name: 'read_backlinks',
    description:
      'List the notes that link to this one, with the source note and the snippet around each link. Use this to find the context a note is referenced in, or to judge how central a note is before renaming or deleting it.',
    inputSchema: textSchema({ noteId: NOTE_ID_PROPERTY }, ['noteId']),
  },
  {
    name: 'read_page_frame',
    description:
      'Read one page frame in full, as both Markdown (round-trips through replace_page_frame_markdown) and plain text. Call this after read_note to get the complete body behind a truncated snippet. Read the current Markdown before replacing a frame so you preserve content you did not intend to change.',
    inputSchema: textSchema(
      { noteId: NOTE_ID_PROPERTY, pageFrameId: PAGE_FRAME_ID_PROPERTY },
      ['noteId', 'pageFrameId'],
    ),
  },
  {
    name: 'read_canvas_text',
    description:
      'Read one floating text element - a plain text box placed directly on the canvas rather than inside a page frame. Returns its full text and bounds. There is no tool to edit these; report changes to the user instead.',
    inputSchema: textSchema(
      { noteId: NOTE_ID_PROPERTY, elementId: elementIdProperty('text') },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_latex',
    description:
      'Read the LaTeX source of one floating math element on the canvas. Returns the raw source, not a rendered image. There is no tool to edit these; report changes to the user instead.',
    inputSchema: textSchema(
      { noteId: NOTE_ID_PROPERTY, elementId: elementIdProperty('latex') },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_image',
    description:
      'Read metadata for one image on the canvas: pixel dimensions, crop rectangle, byte size, and bounds. This returns no pixels and you cannot see the image - do not describe or interpret its contents. Ask the user to share the image directly if its contents matter.',
    inputSchema: textSchema(
      { noteId: NOTE_ID_PROPERTY, elementId: elementIdProperty('image') },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_pdf',
    description:
      'Read metadata for one PDF embedded on the canvas: file name, page count, byte size, and bounds. The PDF text is not extractable through this server (textAvailable is always false), so do not claim knowledge of its contents.',
    inputSchema: textSchema(
      { noteId: NOTE_ID_PROPERTY, elementId: elementIdProperty('pdf') },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_note_full',
    description:
      'Read everything textual in one note at once: the same inventory as read_note, plus the complete Markdown of every page frame and the full text of every canvas text and LaTeX element. Use this when you need the whole note; prefer read_note plus a targeted reader when the note is large, since this response is not paginated or truncated and can be very long.',
    inputSchema: textSchema({ noteId: NOTE_ID_PROPERTY }, ['noteId']),
  },
  {
    name: 'create_page_frame',
    description:
      'Add a new page frame rendered from Markdown to an existing canvas note, and return the created frame. This is the way to write content into a note the user already has. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        noteId: NOTE_ID_PROPERTY,
        markdown: MARKDOWN_PROPERTY,
        displayName: {
          type: 'string',
          description:
            'Label shown on the frame in the canvas UI and usable as the "#Page Frame" part of a note link. Defaults to "Page Frame".',
        },
        x: {
          type: 'number',
          description:
            "Canvas x of the frame's top-left corner, in pixels; the canvas is unbounded and coordinates may be negative. Omit both x and y to place the frame automatically, offset from existing frames so it does not overlap them. A frame is 680x880 pixels, so leave at least that much clearance from the bounds reported by read_note if you set this manually.",
        },
        y: {
          type: 'number',
          description:
            "Canvas y of the frame's top-left corner, in pixels; y increases downward. Omit together with x for automatic placement.",
        },
      },
      ['noteId', 'markdown'],
    ),
  },
  {
    name: 'replace_page_frame_markdown',
    description:
      "Overwrite one page frame's entire body with new Markdown. There is no partial or append edit, so read_page_frame first and send the full intended content - anything you leave out is destroyed. Passing an empty string clears the frame. Requires direct MCP writes to be enabled in Myelin settings.",
    inputSchema: textSchema(
      {
        noteId: NOTE_ID_PROPERTY,
        pageFrameId: PAGE_FRAME_ID_PROPERTY,
        markdown: MARKDOWN_PROPERTY,
      },
      ['noteId', 'pageFrameId', 'markdown'],
    ),
  },
  {
    name: 'create_note',
    description:
      'Create a new canvas note and return its structure, including the new id. Check with search_notes first that a suitable note does not already exist. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        title: {
          type: 'string',
          description:
            'Note title, also its file name. A numeric suffix is appended automatically if the folder already contains this name, so the created title may differ from what you pass - read it back from the response.',
        },
        parentId: PARENT_FOLDER_PROPERTY,
        markdown: {
          ...MARKDOWN_PROPERTY,
          description: `Optional initial page frame content. Omit to create an empty canvas. ${MARKDOWN_PROPERTY.description}`,
        },
      },
      ['title'],
    ),
  },
  {
    name: 'create_folder',
    description:
      'Create a new folder. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        name: {
          type: 'string',
          description:
            'Folder name. A numeric suffix is appended automatically if the parent already contains this name, so read the final name back from the response.',
        },
        parentId: PARENT_FOLDER_PROPERTY,
      },
      ['name'],
    ),
  },
  {
    name: 'move_node',
    description:
      'Move a note, file, or folder into another folder. Note links follow the note, so links keep resolving after a move. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        nodeId: {
          type: 'string',
          description: 'Id of the note, file, or folder to move.',
        },
        newParentId: {
          type: 'string',
          description:
            'Destination folder id. Omit to move to the repository root. Moving a folder into its own descendant is rejected.',
        },
      },
      ['nodeId'],
    ),
  },
  {
    name: 'rename_node',
    description:
      'Rename a note, file, or folder. Because "[[...]]" links reference notes by title, renaming a canvas note rewrites those links across the vault by default and reports what changed. Consider read_backlinks first to see how widely the note is referenced. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        nodeId: {
          type: 'string',
          description: 'Id of the note, file, or folder to rename.',
        },
        newName: {
          type: 'string',
          description:
            'New name. Unlike create_note, this is not deduplicated against siblings.',
        },
        updateReferences: {
          type: 'boolean',
          description:
            'Defaults to true: rewrite "[[...]]" links in other canvas notes to the new title. Pass false to leave them pointing at the old title, which will break them. Ignored for anything other than a canvas note.',
        },
      },
      ['nodeId', 'newName'],
    ),
  },
  {
    name: 'delete_node',
    description:
      'Permanently delete a note, file, or folder. Links pointing at a deleted note are left broken and are not rewritten, so check read_backlinks first. Confirm with the user before calling this. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        nodeId: {
          type: 'string',
          description: 'Id of the note, file, or folder to delete.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Must be true. This exists so a deletion cannot happen by accident; set it only once you intend to delete.',
        },
        recursive: {
          type: 'boolean',
          description:
            'Required (true) to delete a folder that still has children, which also deletes everything inside it. Not needed for files or empty folders.',
        },
      },
      ['nodeId', 'confirm'],
    ),
  },
  {
    name: 'delete_page_frame',
    description:
      'Permanently delete one page frame and all its content from a canvas note, leaving the rest of the canvas untouched. The deleted content is returned so it can be restored with create_page_frame if this was a mistake. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        noteId: NOTE_ID_PROPERTY,
        pageFrameId: PAGE_FRAME_ID_PROPERTY,
        confirm: {
          type: 'boolean',
          description:
            'Must be true. This exists so a deletion cannot happen by accident; set it only once you intend to delete.',
        },
      },
      ['noteId', 'pageFrameId', 'confirm'],
    ),
  },
  {
    name: 'edit_tags',
    description:
      'Change the tags on a note, file, or folder, returning the node with its resulting tags. Provide at least one of set, add, or remove; if several are given they apply in that order. Tags are hierarchical using "/" - call list_tags first and reuse the vocabulary the user already has rather than inventing near-duplicates. Requires direct MCP writes to be enabled in Myelin settings.',
    inputSchema: textSchema(
      {
        nodeId: {
          type: 'string',
          description: 'Id of the note, file, or folder to tag.',
        },
        set: stringArraySchema(
          'Replace all existing tags with exactly these. Destructive - read the current tags first, and prefer add/remove for incremental edits.',
        ),
        add: stringArraySchema('Tags to add, keeping existing ones.'),
        remove: stringArraySchema(
          'Tags to remove. Removal is exact, so "work" does not remove "work/q3".',
        ),
      },
      ['nodeId'],
    ),
  },
];

function isCanvasNote(node: VFSFileNode): boolean {
  return node.fileType === 'mcanvas' && !node.system;
}

function findPageFrameCount(session: NoteSession): number {
  let count = 0;
  for (let index = 0; index < session.ydoc.elements.length; index++) {
    if (
      session.ydoc.elements.get(index).get('type') === ElementType.PAGE_FRAME
    ) {
      count += 1;
    }
  }
  return count;
}

async function noteListItem(
  repository: Repository,
  indexedTextByNode: ReadonlyMap<VFSNodeId, string>,
  node: VFSFileNode,
): Promise<McpNoteListItem> {
  const path = await repository.getFolderChain(node.parentId);
  return {
    id: node.id,
    title: node.name,
    path: [...path.map((folder) => folder.name), node.name],
    fileType: node.fileType,
    tags: [...node.tags],
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
    preview: indexedTextByNode.get(node.id)?.slice(0, 500) ?? null,
  };
}

function normalizeTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return [...new Set(normalized)];
}

async function nodePath(
  repository: Repository,
  node: VFSNode,
): Promise<string[]> {
  const path = await repository.getFolderChain(node.parentId);
  return [...path.map((folder) => folder.name), node.name];
}

async function nodeListItem(
  repository: Repository,
  node: VFSNode,
): Promise<McpNodeListItem> {
  const base = {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    path: await nodePath(repository, node),
    tags: [...node.tags],
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
  };
  if (node.type === 'folder') {
    return {
      ...base,
      type: 'folder',
      childCount: (await repository.listChildIds(node.id)).length,
    };
  }
  return {
    ...base,
    type: 'file',
    fileType: node.fileType,
  };
}

async function requireNode(
  repository: Repository,
  nodeId: VFSNodeId,
): Promise<VFSNode> {
  const node = await repository.getNode(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node;
}

async function requireCanvasNote(
  repository: Repository,
  noteId: VFSNodeId,
): Promise<VFSFileNode> {
  const node = await requireNode(repository, noteId);
  if (node.type !== 'file' || node.fileType !== 'mcanvas') {
    throw new Error(`Node is not a canvas note: ${noteId}`);
  }
  return node;
}

async function targetLinkInfo(
  repository: Repository,
  targetId: VFSNodeId | null,
): Promise<{
  targetName: string | null;
  targetPath: string[] | null;
  targetExists: boolean;
}> {
  if (!targetId) {
    return {
      targetName: null,
      targetPath: null,
      targetExists: false,
    };
  }

  const target = await repository.getNode(targetId);
  if (!target) {
    return {
      targetName: null,
      targetPath: null,
      targetExists: false,
    };
  }

  return {
    targetName: target.name,
    targetPath: await nodePath(repository, target),
    targetExists: true,
  };
}

async function outgoingLinkItem(
  repository: Repository,
  link: StoredNoteLink,
): Promise<{
  targetId: VFSNodeId | null;
  targetTitle: string;
  targetPageFrameId: string | null;
  targetName: string | null;
  targetPath: string[] | null;
  targetExists: boolean;
  snippet: string;
}> {
  return {
    targetId: link.targetId,
    targetTitle: link.title,
    targetPageFrameId: link.pageFrameId,
    ...(await targetLinkInfo(repository, link.targetId)),
    snippet: link.snippet,
  };
}

async function backlinkItem(
  repository: Repository,
  backlink: NoteBacklink,
): Promise<{
  sourceId: VFSNodeId;
  sourceName: string;
  sourcePath: string[] | null;
  targetId: VFSNodeId | null;
  targetTitle: string;
  targetPageFrameId: string | null;
  snippet: string;
}> {
  const source = await repository.getNode(backlink.sourceId);
  return {
    sourceId: backlink.sourceId,
    sourceName: backlink.sourceName,
    sourcePath: source ? await nodePath(repository, source) : null,
    targetId: backlink.targetId,
    targetTitle: backlink.title,
    targetPageFrameId: backlink.pageFrameId,
    snippet: backlink.snippet,
  };
}

async function optionalFolderId(
  repository: Repository,
  folderId: string | undefined,
  key: string,
): Promise<VFSNodeId | null> {
  if (!folderId) {
    return null;
  }
  const node = await requireNode(repository, folderId);
  if (node.type !== 'folder') {
    throw new Error(`${key} is not a folder: ${folderId}`);
  }
  return folderId;
}

async function folderListItem(
  repository: Repository,
  folder: VFSFolderNode,
): Promise<McpFolderListItem> {
  const item = await nodeListItem(repository, folder);
  if (item.type !== 'folder') {
    throw new Error(`Node is not a folder: ${folder.id}`);
  }
  return item;
}

async function fileListItem(
  repository: Repository,
  file: VFSFileNode,
): Promise<McpFileListItem> {
  const item = await nodeListItem(repository, file);
  if (item.type !== 'file') {
    throw new Error(`Node is not a file: ${file.id}`);
  }
  return item;
}

async function collectDirectoryNotes(
  repository: Repository,
  folderId: VFSNodeId | null,
  tag: string | undefined,
  notes: VFSFileNode[],
  limit: number,
): Promise<void> {
  if (notes.length >= limit) {
    return;
  }

  const [folders, files] = await repository.listDirectory(folderId);
  for (const file of files) {
    if (notes.length >= limit) {
      return;
    }
    if (isCanvasNote(file) && (!tag || file.tags.includes(tag))) {
      notes.push(file);
    }
  }
  for (const folder of folders) {
    if (notes.length >= limit) {
      return;
    }
    await collectDirectoryNotes(repository, folder.id, tag, notes, limit);
  }
}

async function noteIsInFolder(
  repository: Repository,
  note: VFSFileNode,
  folderId: VFSNodeId,
): Promise<boolean> {
  const chain = await repository.getFolderChain(note.parentId);
  return chain.some((folder) => folder.id === folderId);
}

export class McpToolService {
  private readonly indexedTextByNode: ReadonlyMap<VFSNodeId, string>;
  private readonly allowDirectWrites: () => boolean;

  constructor(
    private readonly options: {
      repository: ReadableRepository;
      indexedTextByNode?: ReadonlyMap<VFSNodeId, string>;
      allowDirectWrites?: () => boolean;
    },
  ) {
    this.indexedTextByNode = options.indexedTextByNode ?? new Map();
    this.allowDirectWrites = options.allowDirectWrites ?? (() => false);
  }

  listTools(): McpToolDefinition[] {
    return MCP_TOOL_DEFINITIONS;
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const handlers: Record<string, ToolHandler> = {
      list_notes: (input) => this.listNotes(input),
      search_notes: (input) => this.searchNotes(input),
      list_recent_notes: (input) => this.listRecentNotes(input),
      list_tags: (input) => this.listTags(input),
      list_directory: (input) => this.listDirectory(input),
      read_note: (input) => this.readNote(input),
      read_links: (input) => this.readLinks(input),
      read_backlinks: (input) => this.readBacklinks(input),
      read_page_frame: (input) => this.readPageFrame(input),
      read_canvas_text: (input) => this.readCanvasText(input),
      read_latex: (input) => this.readLatex(input),
      read_image: (input) => this.readImage(input),
      read_pdf: (input) => this.readPdf(input),
      read_note_full: (input) => this.readNoteFull(input),
      create_page_frame: (input) => this.createPageFrame(input),
      replace_page_frame_markdown: (input) =>
        this.replacePageFrameMarkdown(input),
      create_note: (input) => this.createNote(input),
      create_folder: (input) => this.createFolder(input),
      move_node: (input) => this.moveNode(input),
      rename_node: (input) => this.renameNode(input),
      delete_node: (input) => this.deleteNode(input),
      delete_page_frame: (input) => this.deletePageFrame(input),
      edit_tags: (input) => this.editTags(input),
    };
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }
    return handler(args);
  }

  private async listNotes(
    args: unknown,
  ): Promise<{ notes: McpNoteListItem[] }> {
    const input = objectArg(args);
    const query = optionalString(input, 'query')?.trim();
    const tag = optionalString(input, 'tag')?.trim();
    const limit = optionalLimit(input);
    const folderId = await optionalFolderId(
      this.options.repository,
      optionalString(input, 'folderId'),
      'folderId',
    );
    let notes: VFSFileNode[];

    if (query) {
      const results = await this.options.repository.searchNodes(query);
      const candidates = results
        .map((result) => result.node)
        .filter((node): node is VFSFileNode => node.type === 'file')
        .filter(isCanvasNote)
        .filter((node) => !tag || node.tags.includes(tag));
      const scoped = folderId
        ? (
            await Promise.all(
              candidates.map(async (note) =>
                (await noteIsInFolder(this.options.repository, note, folderId))
                  ? note
                  : null,
              ),
            )
          ).filter((note): note is VFSFileNode => note !== null)
        : candidates;
      notes = scoped.slice(0, limit);
    } else {
      notes = [];
      await collectDirectoryNotes(
        this.options.repository,
        folderId,
        tag,
        notes,
        limit,
      );
    }

    return {
      notes: await Promise.all(
        notes.map((note) =>
          noteListItem(this.options.repository, this.indexedTextByNode, note),
        ),
      ),
    };
  }

  private async searchNotes(args: unknown): Promise<{
    matches: Array<{
      note: McpNoteListItem;
      score: number;
      contentSnippet: string | null;
      matchedTerms: string[];
    }>;
  }> {
    const input = objectArg(args);
    const query = requiredTrimmedString(input, 'query');
    const tag = optionalString(input, 'tag')?.trim();
    const limit = optionalLimit(input);
    const results = await this.options.repository.searchNodes(query);
    const matches = results
      .filter(
        (result): result is CanvasNoteSearchResult =>
          result.node.type === 'file' && isCanvasNote(result.node),
      )
      .filter((result) => !tag || result.node.tags.includes(tag))
      .slice(0, limit);

    return {
      matches: await Promise.all(
        matches.map(async (result) => ({
          note: await noteListItem(
            this.options.repository,
            this.indexedTextByNode,
            result.node,
          ),
          score: result.score,
          contentSnippet: result.contentSnippet,
          matchedTerms: [...result.matchedTerms],
        })),
      ),
    };
  }

  private async listRecentNotes(
    args: unknown,
  ): Promise<{ notes: McpNoteListItem[] }> {
    const input = objectArg(args);
    const limit = optionalLimit(input);
    const files = await this.options.repository.getRecentFiles(200);
    const notes = files.filter(isCanvasNote).slice(0, limit);
    return {
      notes: await Promise.all(
        notes.map((note) =>
          noteListItem(this.options.repository, this.indexedTextByNode, note),
        ),
      ),
    };
  }

  private async listTags(
    args: unknown,
  ): Promise<{ tags: Array<{ tag: string; count: number }> }> {
    const input = objectArg(args);
    return {
      tags: await this.options.repository.listTags(
        optionalBoolean(input, 'includeAncestors') ?? false,
      ),
    };
  }

  private async listDirectory(args: unknown): Promise<McpDirectoryListing> {
    const input = objectArg(args);
    const folderId = await optionalFolderId(
      this.options.repository,
      optionalString(input, 'folderId'),
      'folderId',
    );
    const [folders, files] =
      await this.options.repository.listDirectory(folderId);
    const folderNode =
      folderId === null
        ? null
        : ((await requireNode(
            this.options.repository,
            folderId,
          )) as VFSFolderNode);

    return {
      folder: folderNode
        ? await folderListItem(this.options.repository, folderNode)
        : null,
      folders: await Promise.all(
        folders.map((folder) =>
          folderListItem(this.options.repository, folder),
        ),
      ),
      files: await Promise.all(
        files.map((file) => fileListItem(this.options.repository, file)),
      ),
    };
  }

  private async readNote(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    return buildMcpNoteReadModel(this.options.repository, noteId, {
      indexedText: this.indexedTextByNode.get(noteId) ?? null,
    });
  }

  private async readLinks(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    const { ydoc } = await loadMcpNote(this.options.repository, noteId);
    const links = extractStoredNoteLinks(ydoc.doc);
    return {
      noteId,
      links: await Promise.all(
        links.map((link) => outgoingLinkItem(this.options.repository, link)),
      ),
    };
  }

  private async readBacklinks(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    await requireCanvasNote(this.options.repository, noteId);
    const backlinks = await this.options.repository.getBacklinks(noteId);
    return {
      noteId,
      backlinks: await Promise.all(
        backlinks.map((backlink) =>
          backlinkItem(this.options.repository, backlink),
        ),
      ),
    };
  }

  private async readPageFrame(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    return readMcpPageFrame(
      this.options.repository,
      requiredString(input, 'noteId'),
      requiredString(input, 'pageFrameId'),
    );
  }

  private async readCanvasText(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    return readMcpCanvasText(
      this.options.repository,
      requiredString(input, 'noteId'),
      requiredString(input, 'elementId'),
    );
  }

  private async readLatex(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    return readMcpLatex(
      this.options.repository,
      requiredString(input, 'noteId'),
      requiredString(input, 'elementId'),
    );
  }

  private async readImage(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    return readMcpImage(
      this.options.repository,
      requiredString(input, 'noteId'),
      requiredString(input, 'elementId'),
    );
  }

  private async readPdf(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    return readMcpPdf(
      this.options.repository,
      requiredString(input, 'noteId'),
      requiredString(input, 'elementId'),
    );
  }

  private async readNoteFull(args: unknown): Promise<unknown> {
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    return readMcpNoteFull(this.options.repository, noteId, {
      indexedText: this.indexedTextByNode.get(noteId) ?? null,
    });
  }

  private assertWritesAllowed(): void {
    if (!this.allowDirectWrites()) {
      throw new Error(
        'Direct MCP writes are disabled. Enable direct MCP writes in Myelin Notes settings to use this tool.',
      );
    }
  }

  private async createNote(args: unknown): Promise<unknown> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const parentId = await optionalFolderId(
      this.options.repository,
      optionalString(input, 'parentId'),
      'parentId',
    );
    const title = await this.options.repository.getUniqueFileName(
      requiredTrimmedString(input, 'title'),
      parentId,
    );
    const markdown = optionalString(input, 'markdown');
    let createdId: VFSNodeId | null = null;
    let session: NoteSession | null = null;

    try {
      createdId =
        markdown === undefined
          ? await createBlankCanvasFile(
              this.options.repository,
              title,
              parentId,
            )
          : await this.options.repository.createFile(
              title,
              'mcanvas',
              parentId,
            );
      if (markdown !== undefined) {
        session = await this.options.repository.openSession(createdId);
        await addMarkdownPageFrameToYDoc(session.ydoc, markdown, {
          repository: this.options.repository,
        });
        await session.save();
        await session.close();
        session = null;
      }

      const noteId = createdId;
      createdId = null;
      return buildMcpNoteReadModel(this.options.repository, noteId, {
        indexedText: null,
      });
    } catch (error) {
      if (session) {
        await session.close().catch(() => {});
      }
      if (createdId) {
        await this.options.repository.deleteNode(createdId).catch(() => {});
      }
      throw error;
    }
  }

  private async createFolder(args: unknown): Promise<McpFolderListItem> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const parentId = await optionalFolderId(
      this.options.repository,
      optionalString(input, 'parentId'),
      'parentId',
    );
    const name = await this.options.repository.getUniqueFileName(
      requiredTrimmedString(input, 'name'),
      parentId,
    );
    const folderId = await this.options.repository.createFolder(name, parentId);
    const folder = await requireNode(this.options.repository, folderId);
    if (folder.type !== 'folder') {
      throw new Error(`Created node is not a folder: ${folderId}`);
    }
    return folderListItem(this.options.repository, folder);
  }

  private async moveNode(args: unknown): Promise<McpNodeListItem> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const nodeId = requiredString(input, 'nodeId');
    const node = await requireNode(this.options.repository, nodeId);
    const newParentId = await optionalFolderId(
      this.options.repository,
      optionalString(input, 'newParentId'),
      'newParentId',
    );
    if (nodeId === newParentId) {
      throw new Error('A node cannot be moved into itself.');
    }

    await this.options.repository.moveNode(nodeId, newParentId);
    const moved = await requireNode(this.options.repository, nodeId);
    if (node.parentId !== newParentId && moved.parentId !== newParentId) {
      throw new Error(
        'Could not move node. The target folder may be inside the moved folder.',
      );
    }
    return nodeListItem(this.options.repository, moved);
  }

  private async renameNode(args: unknown): Promise<{
    node: McpNodeListItem;
    referenceUpdates: RenameNoteReferencesResult | null;
  }> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const nodeId = requiredString(input, 'nodeId');
    const newName = requiredTrimmedString(input, 'newName');
    const node = await requireNode(this.options.repository, nodeId);
    const shouldUpdateReferences =
      optionalBoolean(input, 'updateReferences') !== false &&
      node.type === 'file' &&
      node.fileType === 'mcanvas';
    const backlinks = shouldUpdateReferences
      ? await this.options.repository.getBacklinks(nodeId)
      : undefined;

    await this.options.repository.renameNode(nodeId, newName);
    const referenceUpdates = shouldUpdateReferences
      ? await renameNoteReferences(
          this.options.repository,
          nodeId,
          newName,
          backlinks,
        )
      : null;

    return {
      node: await nodeListItem(
        this.options.repository,
        await requireNode(this.options.repository, nodeId),
      ),
      referenceUpdates,
    };
  }

  private async deleteNode(
    args: unknown,
  ): Promise<{ deleted: McpNodeListItem }> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const nodeId = requiredString(input, 'nodeId');
    if (optionalBoolean(input, 'confirm') !== true) {
      throw new Error('delete_node requires confirm=true.');
    }

    const node = await requireNode(this.options.repository, nodeId);
    const deleted = await nodeListItem(this.options.repository, node);
    if (node.type === 'folder') {
      const [folders, files] = await this.options.repository.listDirectory(
        node.id,
      );
      if (
        folders.length + files.length > 0 &&
        optionalBoolean(input, 'recursive') !== true
      ) {
        throw new Error(
          'delete_node requires recursive=true to delete a non-empty folder.',
        );
      }
    }

    await this.options.repository.deleteNode(nodeId);
    return { deleted };
  }

  private async deletePageFrame(
    args: unknown,
  ): Promise<{ deleted: McpPageFrameContent }> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    const pageFrameId = requiredString(input, 'pageFrameId');
    if (optionalBoolean(input, 'confirm') !== true) {
      throw new Error('delete_page_frame requires confirm=true.');
    }

    const deleted = await readMcpPageFrame(
      this.options.repository,
      noteId,
      pageFrameId,
    );
    let session: NoteSession | null = null;
    try {
      session = await this.options.repository.openSession(noteId);
      const yMap = findElementMap(session.ydoc, pageFrameId);
      if (yMap.get('type') !== ElementType.PAGE_FRAME) {
        throw new Error(`Element is not a page frame: ${pageFrameId}`);
      }
      session.ydoc.removeElementMap(yMap);
      await session.save();
      return { deleted };
    } finally {
      await session?.close().catch(() => {});
    }
  }

  private async editTags(args: unknown): Promise<McpNodeListItem> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const nodeId = requiredString(input, 'nodeId');
    await requireNode(this.options.repository, nodeId);

    const set = optionalStringArray(input, 'set');
    const add = optionalStringArray(input, 'add');
    const remove = optionalStringArray(input, 'remove');
    if (set === undefined && add === undefined && remove === undefined) {
      throw new Error('edit_tags requires set, add, or remove.');
    }

    if (set !== undefined) {
      await this.options.repository.setTags(nodeId, normalizeTags(set));
    }
    for (const tag of normalizeTags(add ?? [])) {
      await this.options.repository.addTag(nodeId, tag);
    }
    for (const tag of normalizeTags(remove ?? [])) {
      await this.options.repository.removeTag(nodeId, tag);
    }

    return nodeListItem(
      this.options.repository,
      await requireNode(this.options.repository, nodeId),
    );
  }

  private async createPageFrame(args: unknown): Promise<McpPageFrameContent> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    const markdown = requiredText(input, 'markdown');
    const displayName = optionalString(input, 'displayName');
    let session: NoteSession | null = null;

    try {
      session = await this.options.repository.openSession(noteId);
      const existingFrameCount = findPageFrameCount(session);
      const offsetX =
        optionalNumber(input, 'x') ??
        DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.x +
          existingFrameCount * CREATE_FRAME_OFFSET_STEP;
      const offsetY =
        optionalNumber(input, 'y') ??
        DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.y +
          existingFrameCount * CREATE_FRAME_OFFSET_STEP;
      const pageFrameId = await addMarkdownPageFrameToYDoc(
        session.ydoc,
        markdown,
        {
          repository: this.options.repository,
          displayName,
          offsetX,
          offsetY,
        },
      );
      await session.save();
      return readMcpPageFrame(this.options.repository, noteId, pageFrameId);
    } finally {
      await session?.close().catch(() => {});
    }
  }

  private async replacePageFrameMarkdown(args: unknown): Promise<unknown> {
    this.assertWritesAllowed();
    const input = objectArg(args);
    const noteId = requiredString(input, 'noteId');
    const pageFrameId = requiredString(input, 'pageFrameId');
    const markdown = requiredText(input, 'markdown');
    let session: NoteSession | null = null;

    try {
      session = await this.options.repository.openSession(noteId);
      const yMap = findElementMap(session.ydoc, pageFrameId);
      if (yMap.get('type') !== ElementType.PAGE_FRAME) {
        throw new Error(`Element is not a page frame: ${pageFrameId}`);
      }
      await writeMarkdownToPageFrameFragment(
        markdown,
        session.ydoc.getXmlFragment(pageFrameId),
        { repository: this.options.repository },
      );
      await session.save();
      return readMcpPageFrame(this.options.repository, noteId, pageFrameId);
    } finally {
      await session?.close().catch(() => {});
    }
  }
}
