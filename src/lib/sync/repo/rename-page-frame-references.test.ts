import { describe, expect, it, vi } from 'vitest';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';
import { serializeDocToMarkdown } from '@myelin/editor/page-frame/markdown/serializer';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { renamePageFrameReferences } from './rename-page-frame-references';
import type { NoteBacklink, VFSFileNode, VFSNodeId } from './types';

function buildSourceDocBytes(opts: {
  frameUuid: string;
  noteLinkAttrs: { title: string; noteId: VFSNodeId; pageFrameId: string };
}): Uint8Array {
  const ydoc = new YDocManager();
  const frameContainerUuid = 'source-frame';
  ydoc.createElementMap(ElementType.PAGE_FRAME, frameContainerUuid, {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    displayName: 'Source Frame',
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
  });

  const noteLinkMark = schema.marks.noteLink.create({
    title: opts.noteLinkAttrs.title,
    noteId: opts.noteLinkAttrs.noteId,
    pageFrameId: opts.noteLinkAttrs.pageFrameId,
  });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, [
      schema.text(`[[${opts.noteLinkAttrs.title}]]`, [noteLinkMark]),
    ]),
  ]);
  const fragment = ydoc.getXmlFragment(frameContainerUuid);
  prosemirrorToYXmlFragment(doc, fragment);
  return ydoc.encodeState();
}

function readFirstPageFrameMarkdown(bytes: Uint8Array): string {
  const ydoc = YDocManager.fromUpdate(bytes);
  for (let i = 0; i < ydoc.elements.length; i++) {
    const yMap = ydoc.elements.get(i);
    if (yMap.get('type') !== ElementType.PAGE_FRAME) {
      continue;
    }
    const uuid = yMap.get('uuid') as string;
    return serializeDocToMarkdown(
      yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(uuid), schema),
    );
  }
  return '';
}

function fileNode(id: VFSNodeId, name: string): VFSFileNode {
  return {
    id,
    name,
    type: 'file',
    fileType: 'mcanvas',
    parentId: null,
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

describe('renamePageFrameReferences', () => {
  it('rewrites page-frame fragments in linked source docs', async () => {
    const ownerNoteId = 'owner-note';
    const sourceId = 'source-note';
    const frameUuid = 'frame-uuid-1';

    const sourceBytes = buildSourceDocBytes({
      frameUuid,
      noteLinkAttrs: {
        title: 'Owner#Draft',
        noteId: ownerNoteId,
        pageFrameId: frameUuid,
      },
    });

    const writes: Array<[string, Uint8Array]> = [];
    const repository = {
      getBacklinks: vi.fn(
        async (): Promise<NoteBacklink[]> => [
          {
            sourceId,
            sourceName: 'Source',
            targetId: ownerNoteId,
            pageFrameId: frameUuid,
            title: 'Owner#Draft',
            snippet: '[[Owner#Draft]]',
          },
        ],
      ),
      getNode: vi.fn(async () => fileNode(sourceId, 'Source')),
      readFileBytes: vi.fn(async () => sourceBytes),
      writeFileBytes: vi.fn(async (id: string, bytes: Uint8Array) => {
        writes.push([id, bytes]);
      }),
    };

    await expect(
      renamePageFrameReferences(repository, ownerNoteId, frameUuid, 'Outline'),
    ).resolves.toEqual({ sourceCount: 1, linkCount: 1 });

    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(sourceId);
    expect(readFirstPageFrameMarkdown(writes[0][1])).toBe(
      '[[Owner#Outline]]\n',
    );
  });

  it('skips the owner note itself to avoid clobbering live edits', async () => {
    const ownerNoteId = 'owner-note';
    const frameUuid = 'frame-uuid-1';
    const repository = {
      getBacklinks: vi.fn(
        async (): Promise<NoteBacklink[]> => [
          {
            sourceId: ownerNoteId,
            sourceName: 'Owner',
            targetId: ownerNoteId,
            pageFrameId: frameUuid,
            title: 'Owner#Draft',
            snippet: '[[Owner#Draft]]',
          },
        ],
      ),
      getNode: vi.fn(),
      readFileBytes: vi.fn(),
      writeFileBytes: vi.fn(),
    };

    await expect(
      renamePageFrameReferences(repository, ownerNoteId, frameUuid, 'Outline'),
    ).resolves.toEqual({ sourceCount: 0, linkCount: 0 });

    expect(repository.readFileBytes).not.toHaveBeenCalled();
    expect(repository.writeFileBytes).not.toHaveBeenCalled();
  });

  it('does not rewrite link titles for unrelated frames', async () => {
    const ownerNoteId = 'owner-note';
    const sourceId = 'source-note';
    const frameUuid = 'frame-target';
    const otherFrameUuid = 'frame-other';

    const sourceBytes = buildSourceDocBytes({
      frameUuid,
      noteLinkAttrs: {
        title: 'Owner#Other',
        noteId: ownerNoteId,
        pageFrameId: otherFrameUuid,
      },
    });

    const repository = {
      getBacklinks: vi.fn(
        async (): Promise<NoteBacklink[]> => [
          {
            sourceId,
            sourceName: 'Source',
            targetId: ownerNoteId,
            pageFrameId: otherFrameUuid,
            title: 'Owner#Other',
            snippet: '[[Owner#Other]]',
          },
        ],
      ),
      getNode: vi.fn(async () => fileNode(sourceId, 'Source')),
      readFileBytes: vi.fn(async () => sourceBytes),
      writeFileBytes: vi.fn(),
    };

    await expect(
      renamePageFrameReferences(repository, ownerNoteId, frameUuid, 'Outline'),
    ).resolves.toEqual({ sourceCount: 0, linkCount: 0 });

    expect(repository.writeFileBytes).not.toHaveBeenCalled();
  });
});
