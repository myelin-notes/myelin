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

export interface McpStrokeSummary extends McpElementBase {
  kind: 'stroke';
  pointCount: number;
  color: string | null;
  size: number | null;
}

export interface McpUnknownElementSummary extends McpElementBase {
  kind: 'unknown';
  keys: string[];
}

export type McpNoteElementSummary =
  | McpPageFrameSummary
  | McpTextElementSummary
  | McpImageSummary
  | McpPdfSummary
  | McpLatexSummary
  | McpStrokeSummary
  | McpUnknownElementSummary;

export interface McpNoteReadModel {
  note: McpNoteMetadata;
  indexedText: string | null;
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
 * MCP content blocks a tool can return instead of a JSON payload. The bridge
 * passes these through to `tools/call` verbatim, so an image reaches the model
 * as an image rather than as an unreadable base64 string.
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
