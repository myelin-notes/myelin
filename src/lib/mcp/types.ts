import type { FileType, VFSNodeId } from '@/lib/sync';

export interface McpBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface McpNoteMetadata {
  id: VFSNodeId;
  title: string;
  path: string[];
  tags: string[];
  createdAt: number;
  modifiedAt: number;
}

export interface McpElementBase {
  id: string;
  type: number | null;
  bounds: McpBounds;
  reader: string | null;
}

export interface McpPageFrameSummary extends McpElementBase {
  kind: 'page-frame';
  displayName: string;
  layout: 'vertical' | 'horizontal' | 'continuous';
  snippet: string;
}

export interface McpTextElementSummary extends McpElementBase {
  kind: 'text';
  text: string;
  style: {
    color: string | null;
    fontSize: number | null;
    fontFamily: string | null;
  };
}

export interface McpImageSummary extends McpElementBase {
  kind: 'image';
  naturalWidth: number | null;
  naturalHeight: number | null;
  crop: McpBounds | null;
  byteLength: number | null;
  resourceUri: string;
}

export interface McpPdfSummary extends McpElementBase {
  kind: 'pdf';
  fileName: string | null;
  pageCount: number | null;
  byteLength: number | null;
  textAvailable: boolean;
  resourceUri: string;
}

export interface McpLatexSummary extends McpElementBase {
  kind: 'latex';
  latex: string;
}

/**
 * Ink collapses into a single entry rather than one element per stroke: a note holds hundreds of
 * strokes, so ids and paths are left to read_strokes and only per-stroke `boxes` are kept here.
 */
export interface McpStrokeGroupSummary {
  kind: 'stroke-group';
  reader: string;
  count: number;
  /** Union of every stroke box, for framing one capture over all the ink. */
  bounds: McpBounds;
  /** Per-stroke `[x, y, width, height]`, in document order. */
  boxes: [number, number, number, number][];
}

export interface McpUnknownElementSummary extends McpElementBase {
  kind: 'unknown';
  keys: string[];
}

/** The kinds read_note lists one entry per element for; strokes are grouped instead. */
export type McpIndividualElementSummary =
  | McpPageFrameSummary
  | McpTextElementSummary
  | McpImageSummary
  | McpPdfSummary
  | McpLatexSummary
  | McpUnknownElementSummary;

export type McpNoteElementSummary =
  | McpIndividualElementSummary
  | McpStrokeGroupSummary;

export interface McpStrokeSummary extends McpElementBase {
  kind: 'stroke';
}

/** One element as the write tools report it; unlike read_note, strokes stand alone. */
export type McpElementSummary = McpIndividualElementSummary | McpStrokeSummary;

export interface McpElementWriteResult {
  noteId: VFSNodeId;
  element: McpElementSummary;
}

export interface McpStrokeStyle {
  color: string;
  size: number;
  /** True when the stroke recorded stylus pressure, so its width varies along the path. */
  pressure: boolean;
}

export interface McpStrokePath {
  /** Only present when read_strokes was asked for ids. */
  id?: string;
  /** Index into `McpStrokesRead.styles`. */
  style: number;
  /** Space-separated `x,y` or `x,y,pressure` points, relative to `McpStrokesRead.origin`. */
  points: string;
}

export interface McpStrokesRead {
  noteId: VFSNodeId;
  /** Canvas position every point is relative to. */
  origin: { x: number; y: number };
  /** Strokes that matched the region, before `limit` was applied. */
  total: number;
  styles: McpStrokeStyle[];
  strokes: McpStrokePath[];
}

export interface McpStrokesCreated {
  noteId: VFSNodeId;
  strokeIds: string[];
  bounds: McpBounds;
}

export interface McpNoteReadModel {
  note: McpNoteMetadata;
  elements: McpNoteElementSummary[];
}

export interface McpPageFrameContent {
  noteId: VFSNodeId;
  pageFrameId: string;
  displayName: string;
  bounds: McpBounds;
  layout: 'vertical' | 'horizontal' | 'continuous';
  markdown: string;
  plainText: string;
}

export interface McpCanvasTextContent {
  noteId: VFSNodeId;
  elementId: string;
  text: string;
  bounds: McpBounds;
}

export interface McpLatexContent {
  noteId: VFSNodeId;
  elementId: string;
  latex: string;
  bounds: McpBounds;
}

export interface McpImageContent extends McpImageSummary {
  noteId: VFSNodeId;
}

export interface McpPdfContent extends McpPdfSummary {
  noteId: VFSNodeId;
}

export interface McpNoteFullReadModel extends McpNoteReadModel {
  pageFrames: McpPageFrameContent[];
  canvasTexts: McpCanvasTextContent[];
  latexBlocks: McpLatexContent[];
}

export interface McpScreenshot {
  noteId: VFSNodeId;
  /** World-space rect actually captured, after defaults were applied. */
  region: McpBounds;
  mimeType: 'image/png';
  base64: string;
}

/**
 * MCP content blocks a tool can return instead of a JSON payload. The bridge passes these through
 * to `tools/call` verbatim, so an image reaches the model as an image rather than base64 text.
 */
export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface McpToolContentResult {
  content: McpContentBlock[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpBridgeToolCallPayload {
  requestId: string;
  toolName: string;
  arguments: unknown;
}

export interface McpBridgeToolResponse {
  requestId: string;
  result?: unknown;
  /** Pre-built MCP content blocks, used instead of serializing `result`. */
  content?: McpContentBlock[];
  error?: string;
}

export interface McpNoteListItem {
  id: VFSNodeId;
  title: string;
  path: string[];
  fileType: FileType;
  tags: string[];
  createdAt: number;
  modifiedAt: number;
  preview: string | null;
}

export interface McpNodeListItemBase {
  id: VFSNodeId;
  name: string;
  type: 'file' | 'folder';
  parentId: VFSNodeId | null;
  path: string[];
  tags: string[];
  createdAt: number;
  modifiedAt: number;
}

export interface McpFileListItem extends McpNodeListItemBase {
  type: 'file';
  fileType: FileType;
}

export interface McpFolderListItem extends McpNodeListItemBase {
  type: 'folder';
  childCount: number;
}

export type McpNodeListItem = McpFileListItem | McpFolderListItem;

export interface McpDirectoryListing {
  folder: McpFolderListItem | null;
  folders: McpFolderListItem[];
  files: McpFileListItem[];
}
