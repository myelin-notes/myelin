import { EditorState } from 'prosemirror-state';
import type * as Y from 'yjs';
import { ELEMENT_Z_ORDER_KEY } from '@myelin/editor/canvas-document-binding';
import { ADAPTIVE_INK } from '@myelin/editor/canvas-theme';
import type { PageFrameAnchor } from '@myelin/editor/elements/anchorable-element';
import { getElementDescriptor } from '@myelin/editor/elements/element-descriptors';
import {
  ElementType,
  isBackgroundElement,
} from '@myelin/editor/elements/element-type';
import { LATEX_FONT_SIZE_BASE } from '@myelin/editor/elements/latex/element';
import type { PageLayout } from '@myelin/editor/elements/page-frame-constants';
import { PdfDocumentModel } from '@myelin/editor/elements/pdf/document-model';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import {
  TextElement,
  type TextStyle,
} from '@myelin/editor/elements/text/element';
import {
  applyDocumentStyle,
  docFromJson,
  docFromText,
  textSchema,
} from '@myelin/editor/elements/text/rich-text';
import type { PdfPageSize } from '@myelin/editor/pdf-renderer';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import { getMcpElementBounds } from './read-model';

// TextElement lays text out at 1.3x its font size.
const TEXT_LINE_HEIGHT = 1.3;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  color: ADAPTIVE_INK,
  fontSize: 24,
  fontFamily: 'Inter',
  bold: false,
  italic: false,
};

export const DEFAULT_STROKE_COLOR = ADAPTIVE_INK;
export const DEFAULT_STROKE_SIZE = 8;

function numberField(
  yMap: Y.Map<unknown>,
  key: string,
  fallback: number,
): number {
  const value = yMap.get(key);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// Mirrors CanvasDocumentBinding.addElement: foreground elements go on top, backdrops (PDFs) go to
// the bottom of the background layer. The canvas falls back to array index for a missing zOrder.
function insertionZOrder(ydoc: YDocManager, background: boolean): number {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < ydoc.elements.length; index++) {
    const yMap = ydoc.elements.get(index);
    if (isBackgroundElement(yMap.get('type') as ElementType) !== background) {
      continue;
    }
    const zOrder = numberField(yMap, ELEMENT_Z_ORDER_KEY, index);
    lowest = Math.min(lowest, zOrder);
    highest = Math.max(highest, zOrder);
  }
  if (background) {
    return Number.isFinite(lowest) ? lowest - 1 : -1;
  }
  return Number.isFinite(highest) ? highest + 1 : 0;
}

function insertElement(
  ydoc: YDocManager,
  type: ElementType,
  placement: { x: number; y: number; scale?: number },
  props: Record<string, unknown>,
): Y.Map<unknown> {
  const background = isBackgroundElement(type);
  const scale = placement.scale ?? 1;
  const fullProps = {
    offsetX: placement.x,
    offsetY: placement.y,
    scaleX: scale,
    scaleY: scale,
    [ELEMENT_Z_ORDER_KEY]: insertionZOrder(ydoc, background),
    ...props,
  };
  const uuid = crypto.randomUUID();
  return background
    ? ydoc.insertElementMap(0, type, uuid, fullProps)
    : ydoc.createElementMap(type, uuid, fullProps);
}

export function insertCanvasText(
  ydoc: YDocManager,
  input: {
    text: string;
    x: number;
    y: number;
    width?: number;
    style: TextStyle;
  },
): Y.Map<unknown> {
  // The canvas grows a box to fit its text but never persists that, so size it to the line count.
  const lines = input.text.split('\n').length;
  const element = new TextElement(
    '',
    input.text,
    input.style,
    input.width,
    lines * input.style.fontSize * TEXT_LINE_HEIGHT,
  );
  return insertElement(
    ydoc,
    ElementType.TEXT,
    { x: input.x, y: input.y },
    element.getYMapProps(),
  );
}

export function insertLatex(
  ydoc: YDocManager,
  input: { latex: string; x: number; y: number; fontSize?: number },
): Y.Map<unknown> {
  return insertElement(
    ydoc,
    ElementType.LATEX,
    {
      x: input.x,
      y: input.y,
      scale: (input.fontSize ?? LATEX_FONT_SIZE_BASE) / LATEX_FONT_SIZE_BASE,
    },
    { latex: input.latex },
  );
}

export function insertImage(
  ydoc: YDocManager,
  input: {
    bytes: Uint8Array;
    naturalWidth: number;
    naturalHeight: number;
    x: number;
    y: number;
    width?: number;
  },
): Y.Map<unknown> {
  return insertElement(
    ydoc,
    ElementType.IMAGE,
    {
      x: input.x,
      y: input.y,
      scale: input.width === undefined ? 1 : input.width / input.naturalWidth,
    },
    {
      imageData: input.bytes,
      naturalWidth: input.naturalWidth,
      naturalHeight: input.naturalHeight,
      cropX: 0,
      cropY: 0,
      cropW: input.naturalWidth,
      cropH: input.naturalHeight,
    },
  );
}

export function insertPdf(
  ydoc: YDocManager,
  input: {
    bytes: Uint8Array;
    fileName: string;
    pageSizes: PdfPageSize[];
    pageLayout: PageLayout;
    x: number;
    y: number;
  },
): Y.Map<unknown> {
  const model = new PdfDocumentModel(input.pageLayout);
  model.setBytes(input.bytes);
  model.setFileName(input.fileName);
  model.setPageSizes(input.pageSizes);
  return insertElement(
    ydoc,
    ElementType.PDF,
    { x: input.x, y: input.y },
    model.getYMapProps(),
  );
}

export interface McpStrokeInput {
  /** Flat `[x, y, pressure, ...]` in canvas coordinates. */
  points: number[];
  hasPressure: boolean;
  color: string;
  size: number;
}

export function insertStrokes(
  ydoc: YDocManager,
  strokes: readonly McpStrokeInput[],
): Y.Map<unknown>[] {
  const yMaps: Y.Map<unknown>[] = [];
  ydoc.transact(() => {
    for (const stroke of strokes) {
      // No stabilization: the points are deliberate, so they render where they were placed.
      // Without pressure the width stays uniform rather than following simulated pen speed.
      const element = new StrokeElement('', stroke.points, stroke.hasPressure, {
        color: stroke.color,
        size: stroke.size,
        stabilization: 0,
        simulatePressure: stroke.hasPressure ? undefined : false,
      });
      yMaps.push(
        insertElement(
          ydoc,
          ElementType.STROKE,
          { x: 0, y: 0 },
          element.getYMapProps(),
        ),
      );
    }
  });
  return yMaps;
}

export interface McpElementChanges {
  x?: number;
  y?: number;
  width?: number;
  text?: string;
  latex?: string;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
}

const TEXT_STYLE_KEYS = [
  'color',
  'fontSize',
  'fontFamily',
  'bold',
  'italic',
] as const;

const EDITABLE_FIELDS: Partial<
  Record<ElementType, readonly (keyof McpElementChanges)[]>
> = {
  [ElementType.TEXT]: ['x', 'y', 'width', 'text', ...TEXT_STYLE_KEYS],
  [ElementType.LATEX]: ['x', 'y', 'latex', 'fontSize'],
  [ElementType.IMAGE]: ['x', 'y', 'width'],
  [ElementType.PDF]: ['x', 'y', 'width'],
  [ElementType.STROKE]: ['x', 'y'],
};

function updateTextContent(
  yMap: Y.Map<unknown>,
  changes: McpElementChanges,
): void {
  const styleUpdates: Partial<TextStyle> = {};
  for (const key of TEXT_STYLE_KEYS) {
    if (changes[key] !== undefined) {
      Object.assign(styleUpdates, { [key]: changes[key] });
    }
  }
  if (changes.text === undefined && Object.keys(styleUpdates).length === 0) {
    return;
  }

  const currentText = yMap.get('text');
  let doc =
    changes.text !== undefined
      ? docFromText(changes.text)
      : docFromJson(
          yMap.get('richText'),
          typeof currentText === 'string' ? currentText : '',
        );
  // Same pass as TextElement.setWholeDocumentStyle: per-run marks are overwritten, not left to
  // shadow the new document style.
  if (Object.keys(styleUpdates).length > 0) {
    const state = EditorState.create({ schema: textSchema, doc });
    doc = state.apply(applyDocumentStyle(state, styleUpdates)).doc;
  }

  if (changes.text !== undefined) {
    yMap.set('text', changes.text);
  }
  for (const [key, value] of Object.entries(styleUpdates)) {
    yMap.set(key, value);
  }
  yMap.set('richText', doc.toJSON());
}

function updateWidth(yMap: Y.Map<unknown>, width: number): void {
  const type = yMap.get('type');
  const scaleX = numberField(yMap, 'scaleX', 1);
  if (type === ElementType.TEXT) {
    yMap.set('boxWidth', width / Math.abs(scaleX));
    return;
  }

  const current = getMcpElementBounds(yMap).width;
  if (current <= 0) {
    throw new Error('Element has no width to scale from.');
  }
  const ratio = width / current;
  yMap.set('scaleX', scaleX * ratio);
  yMap.set('scaleY', numberField(yMap, 'scaleY', 1) * ratio);
}

// Moves the bounds' top-left. Anchored elements render at their anchor plus the anchor's x/y, so
// those shift too, as AnchorableElement.setOffset does.
function moveTo(yMap: Y.Map<unknown>, x?: number, y?: number): void {
  const bounds = getMcpElementBounds(yMap);
  const dx = x === undefined ? 0 : x - bounds.x;
  const dy = y === undefined ? 0 : y - bounds.y;
  if (dx === 0 && dy === 0) {
    return;
  }
  yMap.set('offsetX', numberField(yMap, 'offsetX', 0) + dx);
  yMap.set('offsetY', numberField(yMap, 'offsetY', 0) + dy);
  const anchor = yMap.get('pageAnchor') as PageFrameAnchor | null | undefined;
  if (anchor) {
    yMap.set('pageAnchor', { ...anchor, x: anchor.x + dx, y: anchor.y + dy });
  }
}

export function updateElement(
  ydoc: YDocManager,
  yMap: Y.Map<unknown>,
  changes: McpElementChanges,
): void {
  const type = yMap.get('type') as ElementType;
  const kind = getElementDescriptor(type)?.name ?? 'unknown';
  const allowed = EDITABLE_FIELDS[type];
  if (!allowed) {
    throw new Error(
      kind === 'page-frame'
        ? 'Page frames are edited with replace_page_frame_markdown.'
        : `${kind} elements cannot be edited through MCP.`,
    );
  }
  const given = (Object.keys(changes) as (keyof McpElementChanges)[]).filter(
    (key) => changes[key] !== undefined,
  );
  if (given.length === 0) {
    throw new Error('update_element needs at least one field to change.');
  }
  const rejected = given.filter((key) => !allowed.includes(key));
  if (rejected.length > 0) {
    throw new Error(
      `${rejected.join(', ')} ${rejected.length === 1 ? 'does' : 'do'} not apply to ${kind} elements; editable fields are ${allowed.join(', ')}.`,
    );
  }

  ydoc.transact(() => {
    if (type === ElementType.TEXT) {
      updateTextContent(yMap, changes);
    }
    if (changes.latex !== undefined) {
      yMap.set('latex', changes.latex);
    }
    if (type === ElementType.LATEX && changes.fontSize !== undefined) {
      const scale = changes.fontSize / LATEX_FONT_SIZE_BASE;
      yMap.set('scaleX', scale);
      yMap.set('scaleY', scale);
    }
    if (changes.width !== undefined) {
      updateWidth(yMap, changes.width);
    }
    moveTo(yMap, changes.x, changes.y);
  });
}
