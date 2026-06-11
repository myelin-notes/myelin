import type * as Y from 'yjs';
import type {
  NoteSession,
  Repository,
  VFSFileNode,
  VFSNodeId,
} from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import {
  addMarkdownPageFrameToYDoc,
  DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET,
  writeMarkdownToPageFrameFragment,
} from '@/pages/canvas/page-frame/markdown/import';
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
  McpNoteListItem,
  McpPageFrameContent,
  McpToolDefinition,
} from './types';

type ToolHandler = (args: unknown) => Promise<unknown>;

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
    name: 'read_note',
    description:
      'Read structured note inventory, including page frames, floating text, assets, drawings, and cached indexed text.',
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

async function collectDirectoryNotes(
  repository: Repository,
  folderId: VFSNodeId | null,
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
    if (isCanvasNote(file)) {
      notes.push(file);
    }
  }
  for (const folder of folders) {
    if (notes.length >= limit) {
      return;
    }
    await collectDirectoryNotes(repository, folder.id, notes, limit);
  }
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
      read_note: (input) => this.readNote(input),
      read_page_frame: (input) => this.readPageFrame(input),
      read_canvas_text: (input) => this.readCanvasText(input),
      read_latex: (input) => this.readLatex(input),
      read_image: (input) => this.readImage(input),
      read_pdf: (input) => this.readPdf(input),
      read_note_full: (input) => this.readNoteFull(input),
      create_page_frame: (input) => this.createPageFrame(input),
      replace_page_frame_markdown: (input) =>
        this.replacePageFrameMarkdown(input),
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
    let notes: VFSFileNode[];

    if (query) {
      const results = await this.options.repository.searchNodes(query);
      notes = results
        .map((result) => result.node)
        .filter((node): node is VFSFileNode => node.type === 'file')
        .filter(isCanvasNote)
        .slice(0, limit);
    } else {
      notes = [];
      await collectDirectoryNotes(
        this.options.repository,
        optionalString(input, 'folderId') ?? null,
        notes,
        limit,
      );
    }

    const filtered = tag
      ? notes.filter((note) => note.tags.includes(tag))
      : notes;
    return {
      notes: await Promise.all(
        filtered
          .slice(0, limit)
          .map((note) =>
            noteListItem(this.options.repository, this.indexedTextByNode, note),
          ),
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
