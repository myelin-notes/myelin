import { describe, expect, it, vi } from 'vitest';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import * as Y from 'yjs';
import {
  getCanvasStyleOverride,
  setCanvasStyle,
} from '@myelin/editor/canvas-style';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  docFromJson,
  docFromText,
} from '@myelin/editor/elements/text/rich-text';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { noteJson } from '@/pages/library/export/workspace-json';
import { importTemplateFile } from '@/pages/library/import/template';
import { TestRepository } from '@/test/test-repository';
import {
  createCanvasFromTemplate,
  fillTemplateFields,
  saveAsTemplate,
} from './templates';

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

describe('fillTemplateFields', () => {
  it('fills tokens in text boxes and page frames with the final name, keeping formatting and the template intact', async () => {
    const repository = new TestRepository('repositories/template-fields');
    const ydoc = new YDocManager();
    ydoc.createElementMap(ElementType.TEXT, 'text-1', {
      text: '{title} – {weekday}',
      richText: docFromText('{title} – {weekday}').toJSON(),
    });
    ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-1', {});
    const page = schema.node('doc', null, [
      schema.node('heading', { level: 1 }, [
        schema.text('{title}', [schema.marks.bold.create()]),
      ]),
      schema.node('paragraph', null, [schema.text('Price: {cost}')]),
    ]);
    ydoc.transact(() =>
      prosemirrorToYXmlFragment(page, ydoc.getXmlFragment('frame-1')),
    );
    const rootId = await repository.ensureTemplatesRoot();
    const templateId = await repository.createFile(
      'Meeting',
      'mcanvas',
      rootId,
      ydoc.encodeState(),
    );

    const createdId = await createCanvasFromTemplate(
      repository,
      'Untitled canvas',
      null,
      templateId,
    );
    await repository.renameNode(createdId, 'Standup $& notes');
    await fillTemplateFields(
      repository,
      createdId,
      'en-US',
      new Date(2026, 6, 10),
    );
    // Inside the templates folder tokens must survive.
    await fillTemplateFields(repository, templateId, 'en-US');

    const read = async (id: string) => {
      const doc = YDocManager.fromUpdate(
        (await repository.loadDocument(id)).update!,
      );
      const text = doc.elements.get(0);
      return {
        text: text.get('text'),
        richText: docFromJson(text.get('richText'), '').textContent,
        page: yXmlFragmentToProseMirrorRootNode(
          doc.getXmlFragment('frame-1'),
          schema,
        ),
      };
    };
    const created = await read(createdId);
    expect(created.text).toBe('Standup $& notes – Friday');
    expect(created.richText).toBe('Standup $& notes – Friday');
    expect(created.page.child(0).textContent).toBe('Standup $& notes');
    expect(created.page.child(0).firstChild!.marks[0].type.name).toBe('bold');
    expect(created.page.child(1).textContent).toBe('Price: {cost}');

    const template = await read(templateId);
    expect(template.text).toBe('{title} – {weekday}');
    expect(template.page.child(0).textContent).toBe('{title}');
  });
});
