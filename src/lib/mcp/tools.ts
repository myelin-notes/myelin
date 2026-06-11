import type * as Y from 'yjs';
import type {
  NodeSearchResult,
  NoteBacklink,
  NoteSession,
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
import { ElementType } from '@/pages/canvas/elements/element-type';
import {
  addMarkdownPageFrameToYDoc,
  DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET,
  writeMarkdownToPageFrameFragment,
} from '@/pages/canvas/page-frame/markdown/import';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import type { McpReadableRepository } from './read-model';
import {
  buildMcpNoteReadModel,
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

function stringArraySchema(): Record<string, unknown> {
  return { type: 'array', items: { type: 'string' } };
}

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'list_notes',
    description: 'List Myelin canvas notes with compact metadata and previews.',
    inputSchema: textSchema({
      query: { type: 'string' },
      folderId: { type: 'string' },
      tag: { type: 'string' },
      limit: { type: 'number' },
    }),
  },
  {
    name: 'search_notes',
    description:
      'Search Myelin canvas notes and return ranked matches with snippets.',
    inputSchema: textSchema(
      {
        query: { type: 'string' },
        tag: { type: 'string' },
        limit: { type: 'number' },
      },
      ['query'],
    ),
  },
  {
    name: 'list_recent_notes',
    description: 'List recently modified Myelin canvas notes.',
    inputSchema: textSchema({
      limit: { type: 'number' },
    }),
  },
  {
    name: 'list_tags',
    description: 'List tags used by notes, files, and folders.',
    inputSchema: textSchema({
      includeAncestors: { type: 'boolean' },
    }),
  },
  {
    name: 'list_directory',
    description:
      'List the immediate notes, files, and folders in one Myelin folder. Omit folderId for the root.',
    inputSchema: textSchema({
      folderId: { type: 'string' },
    }),
  },
  {
    name: 'read_note',
    description:
      'Read structured note inventory, including page frames, floating text, assets, drawings, and cached indexed text.',
    inputSchema: textSchema({ noteId: { type: 'string' } }, ['noteId']),
  },
  {
    name: 'read_links',
    description: 'Read outgoing note links from one canvas note.',
    inputSchema: textSchema({ noteId: { type: 'string' } }, ['noteId']),
  },
  {
    name: 'read_backlinks',
    description: 'Read notes that link to one canvas note.',
    inputSchema: textSchema({ noteId: { type: 'string' } }, ['noteId']),
  },
  {
    name: 'read_page_frame',
    description: 'Read full markdown and plain text for one page frame.',
    inputSchema: textSchema(
      { noteId: { type: 'string' }, pageFrameId: { type: 'string' } },
      ['noteId', 'pageFrameId'],
    ),
  },
  {
    name: 'read_canvas_text',
    description: 'Read one floating canvas text element.',
    inputSchema: textSchema(
      { noteId: { type: 'string' }, elementId: { type: 'string' } },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_latex',
    description: 'Read one floating LaTeX element.',
    inputSchema: textSchema(
      { noteId: { type: 'string' }, elementId: { type: 'string' } },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_image',
    description: 'Read metadata for one image element.',
    inputSchema: textSchema(
      { noteId: { type: 'string' }, elementId: { type: 'string' } },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_pdf',
    description: 'Read metadata for one PDF element.',
    inputSchema: textSchema(
      { noteId: { type: 'string' }, elementId: { type: 'string' } },
      ['noteId', 'elementId'],
    ),
  },
  {
    name: 'read_note_full',
    description:
      'Read a note inventory plus full page-frame, canvas text, and LaTeX contents.',
    inputSchema: textSchema({ noteId: { type: 'string' } }, ['noteId']),
  },
  {
    name: 'create_page_frame',
    description: 'Create a new page frame from markdown in an existing note.',
    inputSchema: textSchema(
      {
        noteId: { type: 'string' },
        markdown: { type: 'string' },
        displayName: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      ['noteId', 'markdown'],
    ),
  },
  {
    name: 'replace_page_frame_markdown',
    description: 'Replace one existing page frame with markdown.',
    inputSchema: textSchema(
      {
        noteId: { type: 'string' },
        pageFrameId: { type: 'string' },
        markdown: { type: 'string' },
      },
      ['noteId', 'pageFrameId', 'markdown'],
    ),
  },
  {
    name: 'create_note',
    description:
      'Create a new canvas note, optionally with an initial markdown page frame.',
    inputSchema: textSchema(
      {
        title: { type: 'string' },
        parentId: { type: 'string' },
        markdown: { type: 'string' },
      },
      ['title'],
    ),
  },
  {
    name: 'create_folder',
    description: 'Create a new folder.',
    inputSchema: textSchema(
      {
        name: { type: 'string' },
        parentId: { type: 'string' },
      },
      ['name'],
    ),
  },
  {
    name: 'move_node',
    description: 'Move a note, file, or folder to another folder.',
    inputSchema: textSchema(
      {
        nodeId: { type: 'string' },
        newParentId: { type: 'string' },
      },
      ['nodeId'],
    ),
  },
  {
    name: 'rename_node',
    description:
      'Rename a note, file, or folder. Canvas-note backlinks are rewritten unless updateReferences=false.',
    inputSchema: textSchema(
      {
        nodeId: { type: 'string' },
        newName: { type: 'string' },
        updateReferences: { type: 'boolean' },
      },
      ['nodeId', 'newName'],
    ),
  },
  {
    name: 'delete_node',
    description:
      'Delete a note, file, or folder. Requires confirm=true; non-empty folders also require recursive=true.',
    inputSchema: textSchema(
      {
        nodeId: { type: 'string' },
        confirm: { type: 'boolean' },
        recursive: { type: 'boolean' },
      },
      ['nodeId', 'confirm'],
    ),
  },
  {
    name: 'delete_page_frame',
    description:
      'Delete one page frame from a canvas note. Requires confirm=true.',
    inputSchema: textSchema(
      {
        noteId: { type: 'string' },
        pageFrameId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      ['noteId', 'pageFrameId', 'confirm'],
    ),
  },
  {
    name: 'edit_tags',
    description:
      'Edit tags on a note, file, or folder. Provide set to replace tags, or add/remove arrays for incremental edits.',
    inputSchema: textSchema(
      {
        nodeId: { type: 'string' },
        set: stringArraySchema(),
        add: stringArraySchema(),
        remove: stringArraySchema(),
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

function findElementMap(
  session: NoteSession,
  elementId: string,
): Y.Map<unknown> {
  for (let index = 0; index < session.ydoc.elements.length; index++) {
    const yMap = session.ydoc.elements.get(index);
    if (yMap.get('uuid') === elementId) {
      return yMap;
    }
  }
  throw new Error(`Element not found: ${elementId}`);
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
      childCount: node.children.length,
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

async function loadYDocForNote(
  repository: McpReadableRepository,
  noteId: VFSNodeId,
): Promise<YDocManager> {
  await requireCanvasNote(repository, noteId);
  const snapshot = await repository.loadDocument(noteId);
  return snapshot.update
    ? YDocManager.fromUpdate(snapshot.update)
    : new YDocManager();
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
      repository: McpReadableRepository;
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
    const ydoc = await loadYDocForNote(this.options.repository, noteId);
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
        'Direct MCP writes are disabled. Enable direct MCP writes in Myelin settings to use this tool.',
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
      createdId = await this.options.repository.createFile(
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
      const yMap = findElementMap(session, pageFrameId);
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
    const markdown = requiredString(input, 'markdown');
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
    const markdown = requiredString(input, 'markdown');
    let session: NoteSession | null = null;

    try {
      session = await this.options.repository.openSession(noteId);
      const yMap = findElementMap(session, pageFrameId);
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
