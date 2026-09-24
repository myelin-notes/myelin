import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { processDocument } from './document-processing';

it('preserves embedded data, merges incremental ink, and detects deletion-only changes', () => {
  const doc = new Y.Doc();
  const elements = doc.getArray<Y.Map<unknown>>('elements');
  const pdf = new Y.Map<unknown>();
  const pdfData = new Uint8Array(1024 * 1024).fill(7);
  pdf.set('pdfData', pdfData);
  elements.push([pdf]);
  const bytes = Y.encodeStateAsUpdate(doc);
  const vector = Y.encodeStateVector(doc);
  const stroke = new Y.Map<unknown>();
  stroke.set('points', [0, 0, 0.5, 10, 10, 0.8]);
  elements.push([stroke]);
  const update = Y.encodeStateAsUpdate(doc, vector);
  const merged = processDocument({ bytes, update });
  expect(merged.changed).toBe(true);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, merged.update!);
  expect(
    restored.getArray<Y.Map<unknown>>('elements').get(0).get('pdfData'),
  ).toEqual(pdfData);
  expect(restored.getArray('elements').length).toBe(2);
  expect(processDocument({ bytes: merged.update, update }).changed).toBe(false);

  const beforeDeletion = Y.encodeStateVector(doc);
  elements.delete(1);
  expect(Y.encodeStateVector(doc)).toEqual(beforeDeletion);
  const deleted = processDocument({
    bytes: merged.update,
    update: Y.encodeStateAsUpdate(doc, beforeDeletion),
  });
  expect(deleted.changed).toBe(true);
  const pulled = processDocument({
    bytes: deleted.update,
    stateVector: beforeDeletion,
  });
  Y.applyUpdate(restored, pulled.update!);
  expect(restored.getArray('elements').length).toBe(1);
  doc.destroy();
  restored.destroy();
});
