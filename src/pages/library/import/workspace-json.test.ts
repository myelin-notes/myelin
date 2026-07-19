import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { serializeNoteElements } from '@/pages/library/export/workspace-json';
import {
  NOTE_JSON_VERSION,
  type NoteJson,
} from '@/pages/library/export/workspace-json-format';
import { resolveImportRootName } from './import-tree';
import { rebuildNote, scanArchive } from './workspace-json';

/** Find the first note-link mark's attrs anywhere in a page frame's PM content. */
function findNoteLinkAttrs(
  content: unknown,
): Record<string, unknown> | undefined {
  if (Array.isArray(content)) {
    for (const child of content) {
      const found = findNoteLinkAttrs(child);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!content || typeof content !== 'object') {
    return undefined;
  }
  const node = content as { marks?: unknown[]; content?: unknown };
  const mark = node.marks?.find(
    (m) => (m as { type?: unknown }).type === 'noteLink',
  ) as { attrs?: Record<string, unknown> } | undefined;
  return mark?.attrs ?? findNoteLinkAttrs(node.content);
}

function pageFrameContent(elements: Record<string, unknown>[]): unknown {
  return elements.find((element) => element.type === ElementType.PAGE_FRAME)
    ?.content;
}

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

  it('remaps note-link ids to the imported note when rebuilding', async () => {
    // Author a note whose link resolved to some id in the source workspace.
    const source = new YDocManager();
    await addMarkdownPageFrameToYDoc(source, 'See [[Target Note]]', {
      resolveNoteLinkId: async () => 'old-source-id' as never,
    });
    const note: NoteJson = {
      version: NOTE_JSON_VERSION,
      name: 'Sample',
      fileType: 'mcanvas',
      tags: [],
      createdAt: 1,
      modifiedAt: 2,
      elements: serializeNoteElements(source),
    };
    expect(findNoteLinkAttrs(pageFrameContent(note.elements))?.noteId).toBe(
      'old-source-id',
    );

    // Import remaps the stale id to the target note's new id in this workspace.
    const rebuilt = new YDocManager();
    rebuildNote(
      rebuilt,
      JSON.parse(JSON.stringify(note)) as NoteJson,
      (title) => (title === 'Target Note' ? ('new-target-id' as never) : null),
    );

    const attrs = findNoteLinkAttrs(
      pageFrameContent(serializeNoteElements(rebuilt)),
    );
    expect(attrs?.noteId).toBe('new-target-id');
    expect(attrs?.title).toBe('Target Note');
  });

  it('clears a note-link id and frame when the target is not imported', async () => {
    const source = new YDocManager();
    await addMarkdownPageFrameToYDoc(source, 'See [[Missing Note]]', {
      resolveNoteLinkId: async () => 'old-source-id' as never,
    });
    const note: NoteJson = {
      version: NOTE_JSON_VERSION,
      name: 'Sample',
      fileType: 'mcanvas',
      tags: [],
      createdAt: 1,
      modifiedAt: 2,
      elements: serializeNoteElements(source),
    };

    const rebuilt = new YDocManager();
    rebuildNote(
      rebuilt,
      JSON.parse(JSON.stringify(note)) as NoteJson,
      () => null,
    );

    const attrs = findNoteLinkAttrs(
      pageFrameContent(serializeNoteElements(rebuilt)),
    );
    expect(attrs?.noteId).toBeNull();
    expect(attrs?.pageFrameId).toBeNull();
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

describe('scanArchive', () => {
  /** Scan a stand-in archive; keys ending in '/' are directory entries. */
  const zipScan = (files: Record<string, string>) =>
    scanArchive(
      Object.fromEntries(
        Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
      ),
      'fallback',
    );

  it('strips the export wrapper folder and adopts its name', () => {
    const scanned = zipScan({
      'My Export/': '',
      'My Export/Note.json': '{}',
      'My Export/Sub/Deep.json': '{}',
    });

    expect(scanned.rootName).toBe('My Export');
    expect(scanned.notes.map((note) => note.path)).toEqual([
      'Note.json',
      'Sub/Deep.json',
    ]);
    expect(scanned.notes[1].folderPath).toBe('Sub');
  });

  it('keeps empty folders so the tree round-trips', () => {
    const scanned = zipScan({
      'Export/': '',
      'Export/Empty/': '',
      'Export/N.json': '{}',
    });
    expect([...scanned.folderPaths]).toEqual(['Empty']);
  });

  it('classifies media and counts unsupported files as skipped', () => {
    const scanned = zipScan({
      'Export/': '',
      'Export/Note.json': '{}',
      'Export/Pic.png': 'x',
      'Export/Weird.xyz': 'x',
    });

    expect(scanned.notes).toHaveLength(1);
    expect(scanned.media.map((file) => file.name)).toEqual(['Pic.png']);
    expect(scanned.skippedFiles).toBe(1);
  });

  it('ignores __MACOSX and dotfile entries', () => {
    const scanned = zipScan({
      'Export/': '',
      'Export/Note.json': '{}',
      '__MACOSX/Export/._Note.json': 'x',
      'Export/.DS_Store': 'x',
    });

    expect(scanned.notes).toHaveLength(1);
    expect(scanned.skippedFiles).toBe(0);
  });

  it('falls back to the zip name when there is no single wrapper folder', () => {
    const scanned = zipScan({ 'A.json': '{}', 'B.json': '{}' });
    expect(scanned.rootName).toBe('fallback');
    expect(scanned.notes.map((note) => note.path)).toEqual([
      'A.json',
      'B.json',
    ]);
  });
});
