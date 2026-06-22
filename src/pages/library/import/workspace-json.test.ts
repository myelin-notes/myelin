import { describe, expect, it } from 'vitest';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown/import';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import { serializeNoteElements } from '@/pages/library/export/workspace-json';
import {
  NOTE_JSON_VERSION,
  type NoteJson,
} from '@/pages/library/export/workspace-json-format';
import { resolveImportRootName } from './import-tree';
import { rebuildNote } from './workspace-json';

/** Build a note with a page frame (text), a stroke, and an image (binary). */
async function buildSampleDoc(): Promise<YDocManager> {
  const ydoc = new YDocManager();
  await addMarkdownPageFrameToYDoc(ydoc, '# Title\n\nHello **world**', {
    displayName: 'Page',
  });
  ydoc.createElementMap(ElementType.STROKE, 'stroke-1', {
    offsetX: 5,
    offsetY: 6,
    scaleX: 1,
    scaleY: 1,
    color: '#ff0000',
    size: 4,
    hasPressure: false,
    points: [0, 0, 0.5, 10, 12, 0.7],
  });
  ydoc.createElementMap(ElementType.IMAGE, 'image-1', {
    offsetX: 20,
    offsetY: 30,
    scaleX: 1,
    scaleY: 1,
    // Include high bytes to exercise base64 fidelity.
    imageData: new Uint8Array([0, 1, 2, 200, 254, 255]),
    naturalWidth: 2,
    naturalHeight: 3,
    cropX: 0,
    cropY: 0,
    cropW: 2,
    cropH: 3,
  });
  return ydoc;
}

describe('workspace JSON round-trip', () => {
  it('reproduces strokes, text, and binaries through export and import', async () => {
    const original = await buildSampleDoc();
    const elements = serializeNoteElements(original);

    // Simulate writing to and reading back from a JSON file on disk.
    const note: NoteJson = {
      version: NOTE_JSON_VERSION,
      name: 'Sample',
      fileType: 'mcanvas',
      tags: ['a', 'b'],
      createdAt: 1,
      modifiedAt: 2,
      elements,
    };
    const reparsed = JSON.parse(JSON.stringify(note)) as NoteJson;

    const rebuilt = new YDocManager();
    rebuildNote(rebuilt, reparsed);

    // Re-serializing the rebuilt doc must match the original serialization,
    // which covers element order, stroke points, page-frame ProseMirror content,
    // and base64-encoded image bytes.
    expect(serializeNoteElements(rebuilt)).toEqual(elements);
  });

  it('decodes image bytes back to the original Uint8Array', async () => {
    const original = await buildSampleDoc();
    const note: NoteJson = {
      version: NOTE_JSON_VERSION,
      name: 'Sample',
      fileType: 'mcanvas',
      tags: [],
      createdAt: 1,
      modifiedAt: 2,
      elements: serializeNoteElements(original),
    };

    const rebuilt = new YDocManager();
    rebuildNote(rebuilt, JSON.parse(JSON.stringify(note)) as NoteJson);

    const image = rebuilt.elements
      .toArray()
      .find((map) => map.get('type') === ElementType.IMAGE);
    expect(image?.get('imageData')).toEqual(
      new Uint8Array([0, 1, 2, 200, 254, 255]),
    );
  });
});

describe('resolveImportRootName', () => {
  function makeRepo() {
    const deleted: string[] = [];
    return {
      deleted,
      repository: {
        deleteNode: async (id: string) => {
          deleted.push(id);
        },
        getUniqueFileName: async (name: string) => `${name} 2`,
      },
    };
  }

  it('returns the name unchanged when there is no conflict', async () => {
    const { repository, deleted } = makeRepo();
    const name = await resolveImportRootName({
      // biome-ignore lint/suspicious/noExplicitAny: minimal repository stub
      repository: repository as any,
      parentId: null,
      name: 'Workspace',
      conflictNodeId: null,
      conflictResolution: 'rename',
    });
    expect(name).toBe('Workspace');
    expect(deleted).toEqual([]);
  });

  it('deletes the existing folder and keeps the name on replace', async () => {
    const { repository, deleted } = makeRepo();
    const name = await resolveImportRootName({
      // biome-ignore lint/suspicious/noExplicitAny: minimal repository stub
      repository: repository as any,
      parentId: null,
      name: 'Workspace',
      conflictNodeId: 'existing-id',
      conflictResolution: 'replace',
    });
    expect(name).toBe('Workspace');
    expect(deleted).toEqual(['existing-id']);
  });

  it('resolves a unique sibling name (no delete) on rename', async () => {
    const { repository, deleted } = makeRepo();
    const name = await resolveImportRootName({
      // biome-ignore lint/suspicious/noExplicitAny: minimal repository stub
      repository: repository as any,
      parentId: null,
      name: 'Workspace',
      conflictNodeId: 'existing-id',
      conflictResolution: 'rename',
    });
    expect(name).toBe('Workspace 2');
    expect(deleted).toEqual([]);
  });
});
