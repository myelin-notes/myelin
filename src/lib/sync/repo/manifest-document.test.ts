import { describe, expect, it } from 'vitest';
import { ManifestDocument } from './manifest-document';
import { addChild, createEmptyManifest, createFolderNode } from './shared';

function clone(document: ManifestDocument): ManifestDocument {
  return ManifestDocument.fromBytes(document.encode());
}

describe('ManifestDocument', () => {
  it('loads legacy JSON manifests with current defaults', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        children: [],
        nodes: {},
        linksBySource: {},
      }),
    );

    expect(ManifestDocument.fromBytes(bytes).getManifest()).toEqual(
      createEmptyManifest(),
    );
  });

  it('merges concurrent node creation without replaying mutations', () => {
    const original = ManifestDocument.fromManifest(createEmptyManifest());
    const left = clone(original);
    const right = clone(original);

    left.mutate((manifest) => {
      manifest.nodes.left = createFolderNode('left', 'Left', null, 1);
      addChild(manifest, null, 'left');
    });
    right.mutate((manifest) => {
      manifest.nodes.right = createFolderNode('right', 'Right', null, 2);
      addChild(manifest, null, 'right');
    });

    left.applyUpdate(right.encode());

    expect(Object.keys(left.getManifest().nodes).sort()).toEqual([
      'left',
      'right',
    ]);
  });

  it('merges concurrent edits to independent node fields', () => {
    const manifest = createEmptyManifest();
    manifest.nodes.folder = createFolderNode('folder', 'Before', null, 1);
    addChild(manifest, null, 'folder');
    const original = ManifestDocument.fromManifest(manifest);
    const left = clone(original);
    const right = clone(original);

    left.mutate((value) => {
      value.nodes.folder.name = 'After';
    });
    right.mutate((value) => {
      value.nodes.folder.tags.push('shared');
    });

    left.applyUpdate(right.encode());

    expect(left.getManifest().nodes.folder).toMatchObject({
      name: 'After',
      tags: ['shared'],
    });
  });

  it('moves a concurrent child to the root when its parent is deleted', () => {
    const manifest = createEmptyManifest();
    manifest.nodes.parent = createFolderNode('parent', 'Parent', null, 1);
    addChild(manifest, null, 'parent');
    const original = ManifestDocument.fromManifest(manifest);
    const left = clone(original);
    const right = clone(original);

    left.mutate((value) => {
      Reflect.deleteProperty(value.nodes, 'parent');
      value.children = [];
    });
    right.mutate((value) => {
      value.nodes.child = createFolderNode('child', 'Child', 'parent', 2);
      const parent = value.nodes.parent;
      if (parent.type === 'folder') {
        parent.children.push('child');
      }
    });

    left.applyUpdate(right.encode());

    expect(left.getManifest().nodes.child.parentId).toBeNull();
    expect(left.getManifest().children).toContain('child');
  });
});
