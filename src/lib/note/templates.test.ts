import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  getCanvasStyleOverride,
  setCanvasStyle,
} from '@myelin/editor/canvas-style';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { noteJson } from '@/pages/library/export/workspace-json';
import { importTemplateFile } from '@/pages/library/import/template';
import { TestRepository } from '@/test/test-repository';
import { createCanvasFromTemplate, saveAsTemplate } from './templates';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
  invoke: vi.fn(),
}));

async function createStyledCanvas(
  repository: TestRepository,
  name: string,
): Promise<string> {
  const ydoc = new YDocManager();
  setCanvasStyle(ydoc.doc, { pattern: 'dots', patternColor: '#112233' });
  return repository.createFile(name, 'mcanvas', null, ydoc.encodeState());
}

async function styleOf(repository: TestRepository, id: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await repository.readFileBytes(id))!);
  return getCanvasStyleOverride(doc);
}

describe('templates', () => {
  it('keeps templates out of listings, recents and search, and copies the canvas style into new canvases', async () => {
    const repository = new TestRepository('repositories/templates');
    const canvasId = await createStyledCanvas(repository, 'Weekly review');
    const canvas = (await repository.getNode(canvasId))!;
    if (canvas.type !== 'file') {
      throw new Error('expected a file');
    }

    await saveAsTemplate(repository, canvas);

    const [templateNode] = await repository.listTemplates();
    await repository.setTags(templateNode.id, ['weekly', 'review']);
    expect(templateNode.name).toBe('Weekly review');
    const [folders, files] = await repository.listDirectory(null);
    expect(folders).toEqual([]);
    expect(files.map((file) => file.id)).toEqual([canvasId]);
    expect((await repository.getRecentFiles(10)).map((n) => n.id)).toEqual([
      canvasId,
    ]);
    const hits = await repository.searchNodes('Weekly');
    expect(hits.map((hit) => hit.node.id)).toEqual([canvasId]);

    const createdId = await createCanvasFromTemplate(
      repository,
      'From template',
      null,
      templateNode.id,
    );
    expect(await styleOf(repository, createdId)).toMatchObject({
      pattern: 'dots',
      patternColor: '#112233',
    });
    expect((await repository.getNode(createdId))?.tags).toEqual([
      'weekly',
      'review',
    ]);
  });

  it('round-trips a template file into the templates folder with its style', async () => {
    const repository = new TestRepository('repositories/template-import');
    const canvasId = await createStyledCanvas(repository, 'Meeting notes');
    const canvas = (await repository.getNode(canvasId))!;
    if (canvas.type !== 'file') {
      throw new Error('expected a file');
    }
    const text = await noteJson(repository, canvas);

    const importedId = await importTemplateFile({
      file: new File([text], 'whatever.myelin-template'),
      repository,
    });

    const [template] = await repository.listTemplates();
    expect(template).toMatchObject({ id: importedId, name: 'Meeting notes' });
    expect(await styleOf(repository, importedId)).toMatchObject({
      pattern: 'dots',
      patternColor: '#112233',
    });
  });
});
