import * as Y from 'yjs';
import { extractStoredNoteLinks } from './note-link-index';
import type { StoredNoteLink } from './types';

export interface DocumentRequest {
  bytes: Uint8Array | null;
  stateVector?: Uint8Array | null;
  update?: Uint8Array;
}

export interface DocumentResult {
  update: Uint8Array | null;
  stateVector: Uint8Array;
  changed: boolean;
  links: StoredNoteLink[];
}

export function processDocument(request: DocumentRequest): DocumentResult {
  const doc = new Y.Doc();
  try {
    if (request.bytes?.byteLength) {
      Y.applyUpdate(doc, request.bytes);
    }
    if (request.update === undefined) {
      return {
        update: request.stateVector
          ? Y.encodeStateAsUpdate(doc, request.stateVector)
          : request.bytes,
        stateVector: Y.encodeStateVector(doc),
        changed: false,
        links: [],
      };
    }
    const previous = Y.encodeStateAsUpdate(doc);
    if (request.update.byteLength) {
      Y.applyUpdate(doc, request.update);
    }
    const merged = Y.encodeStateAsUpdate(doc);
    const changed =
      previous.length !== merged.length ||
      previous.some((value, index) => value !== merged[index]);
    return {
      update: changed ? merged : request.bytes,
      stateVector: Y.encodeStateVector(doc),
      changed,
      links: changed ? extractStoredNoteLinks(doc) : [],
    };
  } finally {
    doc.destroy();
  }
}
