import * as Y from 'yjs';
import { YDocManager } from '../ydoc-manager';
import type {
  CanvasClipboardSelection,
  CanvasClipboardSnapshot,
} from './types';

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type XmlNode = Y.XmlElement | Y.XmlText;

function cloneXmlText(source: Y.XmlText): Y.XmlText {
  const target = new Y.XmlText();
  (
    target as unknown as {
      applyDelta(delta: Array<unknown>): void;
    }
  ).applyDelta(source.toDelta());
  return target;
}

function cloneXmlElement(source: Y.XmlElement): Y.XmlElement {
  const target = new Y.XmlElement(source.nodeName);
  for (const [key, value] of Object.entries(source.getAttributes())) {
    if (value !== undefined) {
      target.setAttribute(key, value);
    }
  }

  const children = (source.toArray() as XmlNode[]).map(cloneXmlNode);
  if (children.length > 0) {
    target.insert(0, children);
  }
  return target;
}

function cloneXmlNode(node: XmlNode): XmlNode {
  return node instanceof Y.XmlText ? cloneXmlText(node) : cloneXmlElement(node);
}

export function copyXmlFragmentInto(
  target: Y.XmlFragment,
  source: Y.XmlFragment,
): void {
  const children = (source.toArray() as XmlNode[]).map(cloneXmlNode);
  if (children.length > 0) {
    target.insert(0, children);
  }
}

function cloneYArray(source: Y.Array<unknown>): Y.Array<unknown> {
  const target = new Y.Array<unknown>();
  const values = source.toArray().map(cloneYValue);
  if (values.length > 0) {
    target.push(values);
  }
  return target;
}

export function cloneYMap(source: Y.Map<unknown>): Y.Map<unknown> {
  const target = new Y.Map<unknown>();
  for (const [key, value] of source.entries()) {
    target.set(key, cloneYValue(value));
  }
  return target;
}

function cloneYValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  if (value instanceof Y.Map) {
    return cloneYMap(value);
  }
  if (value instanceof Y.Array) {
    return cloneYArray(value);
  }
  if (value instanceof Y.XmlText) {
    return cloneXmlText(value);
  }
  if (value instanceof Y.XmlElement) {
    return cloneXmlElement(value);
  }
  if (value instanceof Y.XmlFragment) {
    const target = new Y.XmlFragment();
    copyXmlFragmentInto(target, value);
    return target;
  }
  if (value !== null && typeof value === 'object') {
    return structuredClone(value);
  }
  return value;
}

export function buildCanvasClipboardSnapshot(
  selection: CanvasClipboardSelection,
): CanvasClipboardSnapshot {
  const clipboardDoc = new YDocManager();

  clipboardDoc.transact(() => {
    for (const item of selection.items) {
      clipboardDoc.elements.push([cloneYMap(item.yMap)]);
      if (item.pageFrameFragment) {
        copyXmlFragmentInto(
          clipboardDoc.getXmlFragment(item.index),
          item.pageFrameFragment,
        );
      }
    }
  });

  return {
    version: 1,
    sourceNoteId: selection.noteId,
    selectionBounds: selection.bounds,
    payload: bytesToBase64(clipboardDoc.encodeState()),
  };
}

export function serializeCanvasClipboardSnapshot(
  snapshot: CanvasClipboardSnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function parseCanvasClipboardSnapshot(
  value: string,
): CanvasClipboardSnapshot | null {
  try {
    const parsed = JSON.parse(value) as Partial<CanvasClipboardSnapshot>;
    if (
      parsed.version !== 1 ||
      typeof parsed.sourceNoteId !== 'string' ||
      typeof parsed.payload !== 'string' ||
      !parsed.selectionBounds ||
      typeof parsed.selectionBounds.x !== 'number' ||
      typeof parsed.selectionBounds.y !== 'number' ||
      typeof parsed.selectionBounds.width !== 'number' ||
      typeof parsed.selectionBounds.height !== 'number'
    ) {
      return null;
    }

    return {
      version: 1,
      sourceNoteId: parsed.sourceNoteId,
      selectionBounds: parsed.selectionBounds,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

export function openCanvasClipboardDocument(
  snapshot: CanvasClipboardSnapshot,
): YDocManager {
  return YDocManager.fromUpdate(base64ToBytes(snapshot.payload));
}
