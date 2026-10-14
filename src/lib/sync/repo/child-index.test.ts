import { describe, expect, it } from 'vitest';
import {
  createEmptyManifest,
  createFileNode,
  createFolderNode,
  deleteNodeFromManifest,
  getChildrenIds,
  moveNodeInManifest,
  type VFSManifest,
} from './shared';

function seedFolderWithFile(): {
  manifest: VFSManifest;
  folderId: string;
  fileId: string;
} {
  const manifest = createEmptyManifest();
  const now = 1;
  manifest.nodes.folder = createFolderNode('folder', 'Folder', null, now);
  manifest.nodes.file = createFileNode(
    'file',
    'Note',
    'mcanvas',
    'folder',
    now,
  );
  return { manifest, folderId: 'folder', fileId: 'file' };
}

describe('child index', () => {
  it('lists a child that no container was ever told about', () => {
    // Nothing calls addChild here. Parentage is read straight off parentId, so
    // the node cannot become a ghost that exists but appears in no listing.
    const { manifest, folderId, fileId } = seedFolderWithFile();

    expect(getChildrenIds(manifest, null)).toEqual([folderId]);
    expect(getChildrenIds(manifest, folderId)).toEqual([fileId]);
  });

  it('moves a node out of its old listing and into the new one', () => {
    const { manifest, folderId, fileId } = seedFolderWithFile();
    manifest.nodes.other = createFolderNode('other', 'Other', null, 1);

    moveNodeInManifest(manifest, fileId, 'other');

    expect(getChildrenIds(manifest, folderId)).toEqual([]);
    expect(getChildrenIds(manifest, 'other')).toEqual([fileId]);
  });

  it('drops a deleted folder and its subtree from every listing', () => {
    const { manifest, folderId, fileId } = seedFolderWithFile();

    const deleted = deleteNodeFromManifest(manifest, folderId);

    expect(deleted.map((node) => node.id)).toEqual([fileId]);
    expect(getChildrenIds(manifest, null)).toEqual([]);
    expect(getChildrenIds(manifest, folderId)).toEqual([]);
    expect(manifest.nodes[fileId]).toBeUndefined();
  });

  it('ignores a node whose parent is missing or is not a folder', () => {
    const manifest = createEmptyManifest();
    manifest.nodes.file = createFileNode('file', 'Note', 'mcanvas', null, 1);
    manifest.nodes.orphan = createFileNode(
      'orphan',
      'Orphan',
      'mcanvas',
      'gone',
      1,
    );
    manifest.nodes.nested = createFileNode(
      'nested',
      'Nested',
      'mcanvas',
      'file',
      1,
    );

    expect(getChildrenIds(manifest, null)).toEqual(['file']);
    expect(getChildrenIds(manifest, 'file')).toEqual([]);
  });
});
