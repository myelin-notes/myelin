import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  docFromJson,
  getDocText,
  textSchema,
} from '@myelin/editor/elements/text/rich-text';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { getPdfPageSizes } from '@myelin/editor/pdf-renderer';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { TestRepository } from '@/test/test-repository';
import { findElementMap, loadMcpNote } from './read-model';
import { McpToolService } from './tools';
import type { McpElementWriteResult, McpStrokesCreated } from './types';

vi.mock('@myelin/editor/pdf-renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@myelin/editor/pdf-renderer')>()),
  getPdfPageSizes: vi.fn(),
}));

let repositoryCounter = 0;

async function createNote() {
  repositoryCounter += 1;
  const repository = new TestRepository(
    `repositories/mcp-element-tools-${repositoryCounter}`,
  );
  await repository.initialize();
  const ydoc = new YDocManager();
  const pageFrameId = await addMarkdownPageFrameToYDoc(ydoc, '# Notes', {});
  const noteId = await repository.createFile(
    'Element Note',
    'mcanvas',
    null,
    ydoc.encodeState(),
  );
  return { repository, noteId, pageFrameId };
}

function writer(
  repository: TestRepository,
  readPathArgument?: () => Promise<Uint8Array>,
) {
  return new McpToolService({
    repository,
    allowDirectWrites: () => true,
    readPathArgument,
  });
}

async function storedElement(
  repository: TestRepository,
  noteId: string,
  elementId: string,
) {
  const { ydoc } = await loadMcpNote(repository, noteId);
  return findElementMap(ydoc, elementId);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP element write tools', () => {
  it('blocks every element write unless direct writes are allowed', async () => {
    const { repository, noteId } = await createNote();
    const readPathArgument = vi.fn(async () => new Uint8Array());
    const service = new McpToolService({
      repository,
      allowDirectWrites: () => false,
      readPathArgument,
    });

    for (const tool of [
      'create_canvas_text',
      'create_latex',
      'create_image',
      'create_pdf',
      'create_strokes',
      'update_element',
      'delete_elements',
    ]) {
      await expect(
        service.callTool(tool, { noteId, path: '/tmp/file' }),
      ).rejects.toThrow('Direct MCP writes are disabled');
    }
    expect(readPathArgument).not.toHaveBeenCalled();
  });

  it('reads written strokes back as the same paths, relative to the region', async () => {
    const { repository, noteId } = await createNote();
    const service = writer(repository);

    const created = (await service.callTool('create_strokes', {
      noteId,
      x: 1000,
      y: 500,
      strokes: [
        { points: '0,0 10,4 20,0', color: '#223344', size: 3 },
        { points: '5,10 5,30', color: '#223344', size: 3 },
        { points: '30,0 40,10,0.8', size: 2 },
      ],
    })) as McpStrokesCreated;
    await service.callTool('create_strokes', {
      noteId,
      x: 5000,
      y: 5000,
      strokes: [{ points: '0,0 10,10' }],
    });

    expect(created.strokeIds).toHaveLength(3);
    await expect(
      service.callTool('read_strokes', {
        noteId,
        x: 1000,
        y: 500,
        width: 100,
        height: 100,
        tolerance: 0,
        includePressure: true,
      }),
    ).resolves.toEqual({
      noteId,
      origin: { x: 1000, y: 500 },
      total: 3,
      styles: [
        { color: '#223344', size: 3, pressure: false },
        { color: '#191c1e', size: 2, pressure: true },
      ],
      strokes: [
        { style: 0, points: '0,0 10,4 20,0' },
        { style: 0, points: '5,10 5,30' },
        { style: 1, points: '30,0,0.5 40,10,0.8' },
      ],
    });
  });

  it('simplifies paths without losing corners or the far side of a closed loop', async () => {
    const { repository, noteId } = await createNote();
    const service = writer(repository);
    await service.callTool('create_strokes', {
      noteId,
      x: 0,
      y: 0,
      strokes: [
        { points: '0,0 10,0 20,0 30,0' },
        {
          points: '0,100 5,100 10,100 10,105 10,110 5,110 0,110 0,105 0,100',
        },
      ],
    });

    const read = (await service.callTool('read_strokes', {
      noteId,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    })) as { strokes: { points: string }[] };

    expect(read.strokes.map((stroke) => stroke.points)).toEqual([
      '0,0 30,0',
      '0,100 10,100 10,110 0,110 0,100',
    ]);
  });

  it('creates canvas text and edits it in the rich text the canvas renders', async () => {
    const { repository, noteId } = await createNote();
    const service = writer(repository);

    const created = (await service.callTool('create_canvas_text', {
      noteId,
      text: 'Label',
      x: 100,
      y: 200,
      width: 300,
      fontSize: 20,
    })) as McpElementWriteResult;
    expect(created.element).toMatchObject({
      kind: 'text',
      text: 'Label',
      bounds: { x: 100, y: 200, width: 300 },
      style: { color: '#191c1e', fontSize: 20, fontFamily: 'Inter' },
    });

    const elementId = created.element.id;
    await service.callTool('update_element', {
      noteId,
      elementId,
      text: 'Renamed\nlabel',
      color: '#ff0000',
      x: 150,
    });

    await expect(
      service.callTool('read_canvas_text', { noteId, elementId }),
    ).resolves.toMatchObject({
      text: 'Renamed\nlabel',
      bounds: { x: 150, y: 200 },
    });
    const yMap = await storedElement(repository, noteId, elementId);
    const richText = docFromJson(yMap.get('richText'), '');
    expect(getDocText(richText)).toBe('Renamed\nlabel');
    expect(yMap.get('color')).toBe('#ff0000');
  });

  it('restyles over per-run marks and moves anchored elements with their anchor', async () => {
    const { repository, noteId, pageFrameId } = await createNote();
    const session = await repository.openSession(noteId);
    session.ydoc.createElementMap(ElementType.TEXT, 'anchored-text', {
      offsetX: 50,
      offsetY: 60,
      scaleX: 1,
      scaleY: 1,
      text: 'Hi',
      fontSize: 24,
      richText: textSchema
        .node('doc', null, [
          textSchema.text('Hi', [
            textSchema.marks.textStyle.create({ fontSize: 12 }),
          ]),
        ])
        .toJSON(),
      boxWidth: 200,
      boxHeight: 40,
      pageAnchor: {
        frameId: pageFrameId,
        position: [],
        blockPosition: [],
        spaceBefore: 0,
        x: 5,
        y: 6,
      },
    });
    await session.save();
    await session.close();

    await writer(repository).callTool('update_element', {
      noteId,
      elementId: 'anchored-text',
      fontSize: 30,
      x: 70,
      y: 90,
    });

    const yMap = await storedElement(repository, noteId, 'anchored-text');
    const marks: number[] = [];
    docFromJson(yMap.get('richText'), '').descendants((node) => {
      for (const mark of node.marks) {
        marks.push(mark.attrs.fontSize);
      }
    });
    expect(marks).toEqual([30]);
    expect(yMap.get('offsetX')).toBe(70);
    expect(yMap.get('pageAnchor')).toMatchObject({ x: 25, y: 36 });
  });

  it('rejects fields that do not apply and deletes nothing when any id is invalid', async () => {
    const { repository, noteId, pageFrameId } = await createNote();
    const service = writer(repository);
    const latex = (await service.callTool('create_latex', {
      noteId,
      latex: 'e^{i\\pi}',
      x: 0,
      y: 0,
    })) as McpElementWriteResult;

    await expect(
      service.callTool('update_element', {
        noteId,
        elementId: latex.element.id,
        width: 100,
      }),
    ).rejects.toThrow('width does not apply to latex elements');
    await expect(
      service.callTool('update_element', {
        noteId,
        elementId: pageFrameId,
        x: 0,
      }),
    ).rejects.toThrow('replace_page_frame_markdown');
    await expect(
      service.callTool('delete_elements', {
        noteId,
        elementIds: [latex.element.id, pageFrameId],
        confirm: true,
      }),
    ).rejects.toThrow('delete_page_frame');
    await expect(
      service.callTool('read_latex', { noteId, elementId: latex.element.id }),
    ).resolves.toMatchObject({ latex: 'e^{i\\pi}' });

    await expect(
      service.callTool('delete_elements', {
        noteId,
        elementIds: [latex.element.id],
        confirm: true,
      }),
    ).resolves.toMatchObject({
      deleted: [{ kind: 'latex', latex: 'e^{i\\pi}' }],
    });
    await expect(
      service.callTool('read_latex', { noteId, elementId: latex.element.id }),
    ).rejects.toThrow('Element not found');
  });

  it('embeds an image read from the path and resizes it by width', async () => {
    const { repository, noteId } = await createNote();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 400, height: 200, close() {} })),
    );
    const service = writer(repository, async () => new Uint8Array([1, 2, 3]));

    const created = (await service.callTool('create_image', {
      noteId,
      path: '/Users/me/photo.png',
      x: 10,
      y: 20,
      width: 100,
    })) as McpElementWriteResult;
    expect(created.element).toMatchObject({
      kind: 'image',
      naturalWidth: 400,
      naturalHeight: 200,
      byteLength: 3,
      bounds: { x: 10, y: 20, width: 100, height: 50 },
    });

    await expect(
      service.callTool('update_element', {
        noteId,
        elementId: created.element.id,
        width: 200,
      }),
    ).resolves.toMatchObject({
      element: { bounds: { x: 10, y: 20, width: 200, height: 100 } },
    });
  });

  it('embeds a PDF read from the path under its file name', async () => {
    const { repository, noteId } = await createNote();
    vi.mocked(getPdfPageSizes).mockResolvedValueOnce([
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    ]);
    const service = writer(repository, async () => new Uint8Array([9, 9]));

    await expect(
      service.callTool('create_pdf', {
        noteId,
        path: '/Users/me/papers/Attention.pdf',
        x: -700,
        y: 0,
      }),
    ).resolves.toMatchObject({
      element: {
        kind: 'pdf',
        fileName: 'Attention.pdf',
        pageCount: 2,
        byteLength: 2,
        bounds: { x: -700, y: 0, width: 612 },
      },
    });
  });
});
