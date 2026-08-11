import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  DEFAULT_PAGE_FRAME_DISPLAY_NAME,
  normalizePageFrameDisplayName,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type PageLayout,
} from '@myelin/editor/elements/page-frame-constants';
import { serializeDocToMarkdown } from '@myelin/editor/page-frame/markdown/serializer';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { ReadableRepository, VFSFileNode, VFSNodeId } from '@/lib/sync';
import { roundBounds } from './bounds';
import type {
  McpBounds,
  McpCanvasTextContent,
  McpImageContent,
  McpImageSummary,
  McpLatexContent,
  McpLatexSummary,
  McpNoteElementSummary,
  McpNoteFullReadModel,
  McpNoteMetadata,
  McpNoteReadModel,
  McpPageFrameContent,
  McpPageFrameSummary,
  McpPdfContent,
  McpPdfSummary,
  McpStrokeGroupSummary,
  McpTextElementSummary,
  McpUnknownElementSummary,
} from './types';

const MAX_SNIPPET_LENGTH = 500;

interface LoadedMcpNote {
  note: VFSFileNode;
  metadata: McpNoteMetadata;
  ydoc: YDocManager;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asUint8Array(value: unknown): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}

function asPageLayout(value: unknown): PageLayout {
  return value === 'horizontal' || value === 'continuous' ? value : 'vertical';
}

function normalizeText(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateSnippet(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length <= MAX_SNIPPET_LENGTH) {
    return normalized;
  }

  const truncated = normalized.slice(0, MAX_SNIPPET_LENGTH - 3).trimEnd();
  const wordBoundary = truncated.lastIndexOf(' ');
  if (wordBoundary > MAX_SNIPPET_LENGTH * 0.7) {
    return `${truncated.slice(0, wordBoundary).trimEnd()}...`;
  }
  return `${truncated}...`;
}

function getElementId(yMap: Y.Map<unknown>): string {
  return asString(yMap.get('uuid')) ?? '';
}

function getElementType(yMap: Y.Map<unknown>): number | null {
  return asNumber(yMap.get('type'));
}

function getScale(yMap: Y.Map<unknown>): { x: number; y: number } {
  return {
    x: asNumber(yMap.get('scaleX')) ?? 1,
    y: asNumber(yMap.get('scaleY')) ?? 1,
  };
}

function scaleBounds(
  yMap: Y.Map<unknown>,
  width: number,
  height: number,
  localX = 0,
  localY = 0,
): McpBounds {
  const offsetX = asNumber(yMap.get('offsetX')) ?? 0;
  const offsetY = asNumber(yMap.get('offsetY')) ?? 0;
  const scale = getScale(yMap);
  const x1 = localX * scale.x + offsetX;
  const y1 = localY * scale.y + offsetY;
  const x2 = (localX + width) * scale.x + offsetX;
  const y2 = (localY + height) * scale.y + offsetY;
  return roundBounds({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  });
}

function getPageFrameBounds(yMap: Y.Map<unknown>): McpBounds {
  return scaleBounds(
    yMap,
    asNumber(yMap.get('pageWidth')) ?? PAGE_WIDTH,
    asNumber(yMap.get('pageHeight')) ?? PAGE_HEIGHT,
  );
}

function getTextBounds(yMap: Y.Map<unknown>): McpBounds {
  return scaleBounds(
    yMap,
    asNumber(yMap.get('boxWidth')) ?? 0,
    asNumber(yMap.get('boxHeight')) ?? 0,
  );
}

function getImageBounds(yMap: Y.Map<unknown>): McpBounds {
  return scaleBounds(
    yMap,
    asNumber(yMap.get('cropW')) ?? asNumber(yMap.get('naturalWidth')) ?? 0,
    asNumber(yMap.get('cropH')) ?? asNumber(yMap.get('naturalHeight')) ?? 0,
  );
}

function getPdfBounds(yMap: Y.Map<unknown>): McpBounds {
  const sizes = getPdfPageSizes(yMap);
  const layout = asPageLayout(yMap.get('pageLayout'));
  if (sizes.length === 0) {
    return scaleBounds(yMap, PAGE_WIDTH, PAGE_HEIGHT);
  }

  if (layout === 'horizontal') {
    const width =
      sizes.reduce((sum, size) => sum + size.w, 0) +
      Math.max(0, sizes.length - 1) * PAGE_GAP;
    const height = Math.max(...sizes.map((size) => size.h));
    return scaleBounds(yMap, width, height);
  }

  const width = Math.max(...sizes.map((size) => size.w));
  const height =
    sizes.reduce((sum, size) => sum + size.h, 0) +
    Math.max(0, sizes.length - 1) * PAGE_GAP;
  return scaleBounds(yMap, width, height);
}

function getLatexBounds(yMap: Y.Map<unknown>): McpBounds {
  return scaleBounds(yMap, 0, 0);
}

function getStrokeBounds(yMap: Y.Map<unknown>): McpBounds {
  const points = getNumberArray(yMap.get('points'));
  if (points.length < 2) {
    return scaleBounds(yMap, 0, 0);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 3) {
    const x = points[index];
    const y = points[index + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const pad = (asNumber(yMap.get('size')) ?? 0) / 2;
  return scaleBounds(
    yMap,
    maxX - minX + pad * 2,
    maxY - minY + pad * 2,
    minX - pad,
    minY - pad,
  );
}

function getUnknownBounds(yMap: Y.Map<unknown>): McpBounds {
  return scaleBounds(yMap, 0, 0);
}

function getNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : [];
}

function getPdfPageSizes(yMap: Y.Map<unknown>): { w: number; h: number }[] {
  const raw = yMap.get('pageSizes');
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const w = asNumber(candidate.w);
      const h = asNumber(candidate.h);
      return w !== null && h !== null ? { w, h } : null;
    })
    .filter((entry): entry is { w: number; h: number } => entry !== null);
}

function imageResourceUri(noteId: VFSNodeId, elementId: string): string {
  return `myelin://notes/${encodeURIComponent(noteId)}/images/${encodeURIComponent(elementId)}`;
}

function pdfResourceUri(noteId: VFSNodeId, elementId: string): string {
  return `myelin://notes/${encodeURIComponent(noteId)}/pdfs/${encodeURIComponent(elementId)}`;
}

export async function loadMcpNote(
  repository: ReadableRepository,
  noteId: VFSNodeId,
): Promise<LoadedMcpNote> {
  const node = await repository.getNode(noteId);
  if (!node || node.type !== 'file') {
    throw new Error(`Note not found: ${noteId}`);
  }
  if (node.fileType !== 'mcanvas') {
    throw new Error(`Node is not a canvas note: ${noteId}`);
  }

  const folderChain = await repository.getFolderChain(node.parentId);
  const snapshot = await repository.loadDocument(noteId);
  const ydoc = snapshot.update
    ? YDocManager.fromUpdate(snapshot.update)
    : new YDocManager();

  return {
    note: node,
    metadata: {
      id: node.id,
      title: node.name,
      path: [...folderChain.map((folder) => folder.name), node.name],
      tags: [...node.tags],
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
    },
    ydoc,
  };
}

export function findElementMap(
  ydoc: YDocManager,
  elementId: string,
): Y.Map<unknown> {
  for (let index = 0; index < ydoc.elements.length; index++) {
    const yMap = ydoc.elements.get(index);
    if (getElementId(yMap) === elementId) {
      return yMap;
    }
  }
  throw new Error(`Element not found: ${elementId}`);
}

function pageFrameDoc(ydoc: YDocManager, pageFrameId: string) {
  const fragment = ydoc.getXmlFragment(pageFrameId);
  return yXmlFragmentToProseMirrorRootNode(fragment, schema);
}

function pageFramePlainText(ydoc: YDocManager, pageFrameId: string): string {
  const doc = pageFrameDoc(ydoc, pageFrameId);
  return normalizeText(doc.textBetween(0, doc.content.size, '\n', ' '));
}

function pageFrameMarkdown(ydoc: YDocManager, pageFrameId: string): string {
  return serializeDocToMarkdown(pageFrameDoc(ydoc, pageFrameId));
}

function summarizePageFrame(
  ydoc: YDocManager,
  yMap: Y.Map<unknown>,
): McpPageFrameSummary {
  const id = getElementId(yMap);
  return {
    kind: 'page-frame',
    id,
    type: ElementType.PAGE_FRAME,
    bounds: getPageFrameBounds(yMap),
    reader: 'read_page_frame',
    displayName: normalizePageFrameDisplayName(yMap.get('displayName')),
    layout: asPageLayout(yMap.get('pageLayout')),
    snippet: truncateSnippet(pageFramePlainText(ydoc, id)),
  };
}

function summarizeText(yMap: Y.Map<unknown>): McpTextElementSummary {
  return {
    kind: 'text',
    id: getElementId(yMap),
    type: ElementType.TEXT,
    bounds: getTextBounds(yMap),
    reader: 'read_canvas_text',
    text: asString(yMap.get('text')) ?? '',
    style: {
      color: asString(yMap.get('color')),
      fontSize: asNumber(yMap.get('fontSize')),
      fontFamily: asString(yMap.get('fontFamily')),
    },
  };
}

function summarizeImage(
  noteId: VFSNodeId,
  yMap: Y.Map<unknown>,
): McpImageSummary {
  const id = getElementId(yMap);
  const data = asUint8Array(yMap.get('imageData'));
  const cropW = asNumber(yMap.get('cropW'));
  const cropH = asNumber(yMap.get('cropH'));
  return {
    kind: 'image',
    id,
    type: ElementType.IMAGE,
    bounds: getImageBounds(yMap),
    reader: 'read_image',
    naturalWidth: asNumber(yMap.get('naturalWidth')),
    naturalHeight: asNumber(yMap.get('naturalHeight')),
    crop:
      cropW !== null && cropH !== null
        ? {
            x: asNumber(yMap.get('cropX')) ?? 0,
            y: asNumber(yMap.get('cropY')) ?? 0,
            width: cropW,
            height: cropH,
          }
        : null,
    byteLength: data?.byteLength ?? null,
    resourceUri: imageResourceUri(noteId, id),
  };
}

function summarizePdf(noteId: VFSNodeId, yMap: Y.Map<unknown>): McpPdfSummary {
  const id = getElementId(yMap);
  const data = asUint8Array(yMap.get('pdfData'));
  const pageSizes = getPdfPageSizes(yMap);
  return {
    kind: 'pdf',
    id,
    type: ElementType.PDF,
    bounds: getPdfBounds(yMap),
    reader: 'read_pdf',
    fileName: asString(yMap.get('fileName')),
    pageCount: pageSizes.length > 0 ? pageSizes.length : null,
    byteLength: data?.byteLength ?? null,
    textAvailable: false,
    resourceUri: pdfResourceUri(noteId, id),
  };
}

function summarizeLatex(yMap: Y.Map<unknown>): McpLatexSummary {
  return {
    kind: 'latex',
    id: getElementId(yMap),
    type: ElementType.LATEX,
    bounds: getLatexBounds(yMap),
    reader: 'read_latex',
    latex: asString(yMap.get('latex')) ?? '',
  };
}

function summarizeStrokeGroup(
  boxes: [number, number, number, number][],
): McpStrokeGroupSummary {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y, width, height] of boxes) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    kind: 'stroke-group',
    // Ink carries no text of its own; recognition first, pixels as the fallback.
    reader: 'read_handwriting',
    count: boxes.length,
    bounds: roundBounds({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }),
    boxes,
  };
}

function summarizeUnknown(yMap: Y.Map<unknown>): McpUnknownElementSummary {
  return {
    kind: 'unknown',
    id: getElementId(yMap),
    type: getElementType(yMap),
    bounds: getUnknownBounds(yMap),
    reader: null,
    keys: [...yMap.keys()].sort(),
  };
}

function summarizeElement(
  noteId: VFSNodeId,
  ydoc: YDocManager,
  yMap: Y.Map<unknown>,
): McpNoteElementSummary {
  switch (getElementType(yMap)) {
    case ElementType.PAGE_FRAME:
      return summarizePageFrame(ydoc, yMap);
    case ElementType.TEXT:
      return summarizeText(yMap);
    case ElementType.IMAGE:
      return summarizeImage(noteId, yMap);
    case ElementType.PDF:
      return summarizePdf(noteId, yMap);
    case ElementType.LATEX:
      return summarizeLatex(yMap);
    // ElementType.STROKE is absent on purpose: strokes never reach here because
    // noteReadModelFromLoaded collects them into one stroke-group instead.
    default:
      return summarizeUnknown(yMap);
  }
}

function noteReadModelFromLoaded(
  loaded: LoadedMcpNote,
  options: { indexedText?: string | null } = {},
): McpNoteReadModel {
  const elements: McpNoteElementSummary[] = [];
  const strokeBoxes: [number, number, number, number][] = [];
  // Where the first stroke sat, so the collapsed group keeps document order.
  let strokeSlot = -1;

  for (let index = 0; index < loaded.ydoc.elements.length; index++) {
    const yMap = loaded.ydoc.elements.get(index);
    if (getElementType(yMap) === ElementType.STROKE) {
      const bounds = getStrokeBounds(yMap);
      strokeBoxes.push([bounds.x, bounds.y, bounds.width, bounds.height]);
      if (strokeSlot < 0) {
        strokeSlot = elements.length;
      }
      continue;
    }
    elements.push(summarizeElement(loaded.metadata.id, loaded.ydoc, yMap));
  }

  if (strokeBoxes.length > 0) {
    elements.splice(strokeSlot, 0, summarizeStrokeGroup(strokeBoxes));
  }

  return {
    note: loaded.metadata,
    indexedText: options.indexedText ?? null,
    elements,
  };
}

export async function buildMcpNoteReadModel(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  options: { indexedText?: string | null } = {},
): Promise<McpNoteReadModel> {
  return noteReadModelFromLoaded(
    await loadMcpNote(repository, noteId),
    options,
  );
}

function pageFrameContentFromYMap(
  ydoc: YDocManager,
  noteId: VFSNodeId,
  pageFrameId: string,
  yMap: Y.Map<unknown>,
): McpPageFrameContent {
  if (getElementType(yMap) !== ElementType.PAGE_FRAME) {
    throw new Error(`Element is not a page frame: ${pageFrameId}`);
  }

  return {
    noteId,
    pageFrameId,
    displayName: normalizePageFrameDisplayName(yMap.get('displayName')),
    bounds: getPageFrameBounds(yMap),
    layout: asPageLayout(yMap.get('pageLayout')),
    markdown: pageFrameMarkdown(ydoc, pageFrameId),
    plainText: pageFramePlainText(ydoc, pageFrameId),
  };
}

function pageFrameContentFromYDoc(
  ydoc: YDocManager,
  noteId: VFSNodeId,
  pageFrameId: string,
): McpPageFrameContent {
  return pageFrameContentFromYMap(
    ydoc,
    noteId,
    pageFrameId,
    findElementMap(ydoc, pageFrameId),
  );
}

function canvasTextContentFromYMap(
  noteId: VFSNodeId,
  elementId: string,
  yMap: Y.Map<unknown>,
): McpCanvasTextContent {
  if (getElementType(yMap) !== ElementType.TEXT) {
    throw new Error(`Element is not canvas text: ${elementId}`);
  }
  return {
    noteId,
    elementId,
    text: asString(yMap.get('text')) ?? '',
    bounds: getTextBounds(yMap),
  };
}

function canvasTextContentFromYDoc(
  ydoc: YDocManager,
  noteId: VFSNodeId,
  elementId: string,
): McpCanvasTextContent {
  return canvasTextContentFromYMap(
    noteId,
    elementId,
    findElementMap(ydoc, elementId),
  );
}

function latexContentFromYMap(
  noteId: VFSNodeId,
  elementId: string,
  yMap: Y.Map<unknown>,
): McpLatexContent {
  if (getElementType(yMap) !== ElementType.LATEX) {
    throw new Error(`Element is not LaTeX: ${elementId}`);
  }
  return {
    noteId,
    elementId,
    latex: asString(yMap.get('latex')) ?? '',
    bounds: getLatexBounds(yMap),
  };
}

function latexContentFromYDoc(
  ydoc: YDocManager,
  noteId: VFSNodeId,
  elementId: string,
): McpLatexContent {
  return latexContentFromYMap(
    noteId,
    elementId,
    findElementMap(ydoc, elementId),
  );
}

export async function readMcpPageFrame(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  pageFrameId: string,
): Promise<McpPageFrameContent> {
  const { ydoc } = await loadMcpNote(repository, noteId);
  return pageFrameContentFromYDoc(ydoc, noteId, pageFrameId);
}

export async function readMcpCanvasText(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  elementId: string,
): Promise<McpCanvasTextContent> {
  const { ydoc } = await loadMcpNote(repository, noteId);
  return canvasTextContentFromYDoc(ydoc, noteId, elementId);
}

export async function readMcpLatex(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  elementId: string,
): Promise<McpLatexContent> {
  const { ydoc } = await loadMcpNote(repository, noteId);
  return latexContentFromYDoc(ydoc, noteId, elementId);
}

export async function readMcpImage(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  elementId: string,
): Promise<McpImageContent> {
  const { ydoc } = await loadMcpNote(repository, noteId);
  const yMap = findElementMap(ydoc, elementId);
  if (getElementType(yMap) !== ElementType.IMAGE) {
    throw new Error(`Element is not an image: ${elementId}`);
  }
  return {
    noteId,
    ...summarizeImage(noteId, yMap),
  };
}

export async function readMcpPdf(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  elementId: string,
): Promise<McpPdfContent> {
  const { ydoc } = await loadMcpNote(repository, noteId);
  const yMap = findElementMap(ydoc, elementId);
  if (getElementType(yMap) !== ElementType.PDF) {
    throw new Error(`Element is not a PDF: ${elementId}`);
  }
  return {
    noteId,
    ...summarizePdf(noteId, yMap),
  };
}

export async function readMcpNoteFull(
  repository: ReadableRepository,
  noteId: VFSNodeId,
  options: { indexedText?: string | null } = {},
): Promise<McpNoteFullReadModel> {
  const loaded = await loadMcpNote(repository, noteId);
  const note = noteReadModelFromLoaded(loaded, options);

  // Index every element yMap once so the per-element content builders below
  // don't each re-scan ydoc.elements (which would be O(elements²)).
  const yMapsById = new Map<string, Y.Map<unknown>>();
  for (let index = 0; index < loaded.ydoc.elements.length; index++) {
    const yMap = loaded.ydoc.elements.get(index);
    yMapsById.set(getElementId(yMap), yMap);
  }

  const pageFrames = note.elements
    .filter((element) => element.kind === 'page-frame')
    .map((element) =>
      pageFrameContentFromYMap(
        loaded.ydoc,
        noteId,
        element.id,
        yMapsById.get(element.id)!,
      ),
    );
  const canvasTexts = note.elements
    .filter((element) => element.kind === 'text')
    .map((element) =>
      canvasTextContentFromYMap(noteId, element.id, yMapsById.get(element.id)!),
    );
  const latexBlocks = note.elements
    .filter((element) => element.kind === 'latex')
    .map((element) =>
      latexContentFromYMap(noteId, element.id, yMapsById.get(element.id)!),
    );

  return {
    ...note,
    pageFrames,
    canvasTexts,
    latexBlocks,
  };
}

export { DEFAULT_PAGE_FRAME_DISPLAY_NAME };
