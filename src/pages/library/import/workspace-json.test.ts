import { describe, expect, it, vi } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { invoke } from '@tauri-apps/api/core';
import { MAX_PEN_PRESETS } from '@/lib/sync/repo/config';
import {
  exportWorkspaceJson,
  serializeNoteElements,
} from '@/pages/library/export/workspace-json';
import {
  NOTE_JSON_VERSION,
  type NoteJson,
} from '@/pages/library/export/workspace-json-format';
import type { VaultFileEntry } from '@/pages/library/export/workspace-plan';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { TestRepository } from '@/test/test-repository';
import { resolveImportRootName } from './import-tree';
import { importWorkspaceJson, rebuildNote } from './workspace-json';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
  invoke: vi.fn(),
}));

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

    // Covers element order, stroke points, page-frame ProseMirror content, and base64 image bytes.
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

  it('restores folder, media and workspace settings into an existing workspace', async () => {
    resetRepositoryTestDoubles();
    const storage = getRepositoryTestStorage();
    // Stands in for the Rust vault writer.
    vi.mocked(invoke).mockImplementation(async (_command, args) => {
      const { request } = args as {
        request: {
          destDir: string;
          vaultName: string;
          folders: string[];
          files: VaultFileEntry[];
        };
      };
      const root = `${request.destDir}/${request.vaultName}`;
      for (const folder of request.folders) {
        await storage.mkdir(`${root}/${folder}`, { recursive: true });
      }
      for (const file of request.files) {
        const path = `${root}/${file.relPath}`;
        if (file.text !== undefined) {
          await storage.writeTextFile(path, file.text);
        } else {
          await storage.writeFile(path, await storage.readFile(file.copyFrom!));
        }
      }
      return root;
    });

    const source = new TestRepository('repositories/export-source');
    const folderId = await source.createFolder('Projects', null);
    const photoId = await source.createFile(
      'photo.png',
      'png',
      folderId,
      new Uint8Array([1, 2, 3]),
    );
    await source.setFolderColor(folderId, '#ff8800');
    await source.setTags(folderId, ['work']);
    await source.setTags(photoId, ['img']);
    await source.addCustomColor('#123456', 'pen');
    await source.addPenPreset({ tool: 'pen', color: '#123456', size: 3 });
    await source.addPenPreset({
      tool: 'highlighter',
      color: '#ffee00',
      size: 9,
    });
    await source.addRegistryTags(['archive']);

    const destination = new TestRepository('repositories/import-destination');
    await destination.addCustomColor('#abcdef', 'pen');
    for (let size = 1; size < MAX_PEN_PRESETS; size++) {
      await destination.addPenPreset({ tool: 'pen', color: '#000000', size });
    }

    const { vaultPath } = await exportWorkspaceJson({
      repository: source,
      destDir: { kind: 'native', path: '/exports' },
      exportName: 'Backup',
    });
    const result = await importWorkspaceJson({
      repository: destination,
      parentId: null,
      dirPath: vaultPath,
    });

    expect(result.skippedFiles).toBe(0);
    const [[folder]] = await destination.listDirectory(result.rootFolderId);
    expect(folder).toMatchObject({
      name: 'Projects',
      color: '#ff8800',
      tags: ['work'],
    });
    const [, files] = await destination.listDirectory(folder.id);
    expect(files.find((file) => file.name === 'photo.png')).toMatchObject({
      tags: ['img'],
    });
    expect(await destination.getCustomColors('pen')).toEqual([
      '#abcdef',
      '#123456',
    ]);
    // Merging stops at the cap rather than failing the import.
    const presets = await destination.getPenPresets();
    expect(presets).toHaveLength(MAX_PEN_PRESETS);
    expect(presets.at(-1)).toMatchObject({
      tool: 'pen',
      color: '#123456',
      size: 3,
    });
    expect(await destination.getRegistryTags()).toContain('archive');
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
