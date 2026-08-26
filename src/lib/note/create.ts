import { ElementType } from '@myelin/editor/elements/element-type';
import {
  normalizePageFrameDisplayName,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { Repository, VFSNodeId } from '@/lib/sync';

export async function createBlankCanvasFile(
  repository: Repository,
  name: string,
  parentId: VFSNodeId | null,
  initialPageFrameName?: string | null,
): Promise<VFSNodeId> {
  const ydoc = new YDocManager();
  ydoc.createElementMap(ElementType.PAGE_FRAME, crypto.randomUUID(), {
    offsetX: 425,
    offsetY: 110,
    scaleX: 1,
    scaleY: 1,
    zOrder: 0,
    displayName: normalizePageFrameDisplayName(initialPageFrameName),
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    pageLayout: UserPrefs.get('defaultPageLayout'),
  });
  return repository.createFile(name, 'mcanvas', parentId, ydoc.encodeState());
}
