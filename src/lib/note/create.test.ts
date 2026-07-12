import { describe, expect, it, vi } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createBlankCanvasFile } from './create';

describe('createBlankCanvasFile', () => {
  it('creates a canvas containing its initial page frame', async () => {
    const createFile = vi.fn<Repository['createFile']>(
      async () => 'note-1' as VFSNodeId,
    );
    const repository = { createFile } as unknown as Repository;

    const id = await createBlankCanvasFile(
      repository,
      'Untitled Canvas',
      'folder-1',
    );

    expect(id).toBe('note-1');
    expect(createFile).toHaveBeenCalledTimes(1);
    const [name, fileType, parentId, bytes] = createFile.mock.calls[0];
    expect({ name, fileType, parentId }).toEqual({
      name: 'Untitled Canvas',
      fileType: 'mcanvas',
      parentId: 'folder-1',
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('Expected encoded canvas bytes');
    }
    const ydoc = YDocManager.fromUpdate(bytes);
    expect(ydoc.elements.length).toBe(1);
    expect(Object.fromEntries(ydoc.elements.get(0).entries())).toMatchObject({
      type: ElementType.PAGE_FRAME,
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      zOrder: 0,
      displayName: 'Page Frame',
      pageWidth: PAGE_WIDTH,
      pageHeight: PAGE_HEIGHT,
      pageLayout: 'vertical',
    });
  });

  it('uses an initial page-frame name when one is provided', async () => {
    const createFile = vi.fn<Repository['createFile']>(
      async () => 'note-1' as VFSNodeId,
    );
    const repository = { createFile } as unknown as Repository;

    await createBlankCanvasFile(repository, 'Alpha Note', null, 'Details');

    const bytes = createFile.mock.calls[0]?.[3];
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('Expected encoded canvas bytes');
    }
    const ydoc = YDocManager.fromUpdate(bytes);
    expect(ydoc.elements.get(0).get('displayName')).toBe('Details');
  });
});
