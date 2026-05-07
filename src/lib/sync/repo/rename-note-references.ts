import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { renameNoteLinkReferencesDoc } from '@/pages/canvas/page-frame/pm/markdown/note-links';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import type { FileId, NoteBacklink, Repository } from './types';

type NoteReferenceRepository = Pick<
  Repository,
  'getBacklinks' | 'getNode' | 'readFileBytes' | 'writeFileBytes'
>;

export interface RenameNoteReferencesResult {
  sourceCount: number;
  linkCount: number;
}

function renameReferencesInDoc(
  ydoc: YDocManager,
  noteId: FileId,
  newName: string,
): number {
  let linkCount = 0;

  ydoc.transact(() => {
    for (let i = 0; i < ydoc.elements.length; i++) {
      const yMap = ydoc.elements.get(i);
      if (yMap.get('type') !== ElementType.PAGE_FRAME) {
        continue;
      }

      const index = yMap.get('index');
      if (typeof index !== 'number') {
        continue;
      }

      const fragment = ydoc.getXmlFragment(index);
      if (fragment.length === 0) {
        continue;
      }

      const currentDoc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
      const result = renameNoteLinkReferencesDoc(
        currentDoc,
        schema,
        noteId,
        newName,
      );
      if (result.count === 0) {
        continue;
      }

      fragment.delete(0, fragment.length);
      prosemirrorToYXmlFragment(result.doc, fragment);
      linkCount += result.count;
    }
  });

  return linkCount;
}

export async function renameNoteReferences(
  repository: NoteReferenceRepository,
  noteId: FileId,
  newName: string,
  backlinks?: readonly NoteBacklink[],
): Promise<RenameNoteReferencesResult> {
  const references = backlinks ?? (await repository.getBacklinks(noteId));
  const sourceIds = [
    ...new Set(
      references
        .filter((backlink) => backlink.targetId === noteId)
        .map((backlink) => backlink.sourceId),
    ),
  ];

  let sourceCount = 0;
  let linkCount = 0;
  for (const sourceId of sourceIds) {
    const node = await repository.getNode(sourceId);
    if (!node || node.type !== 'file' || node.fileType !== 'mcanvas') {
      continue;
    }

    const bytes = await repository.readFileBytes(sourceId);
    if (!bytes || bytes.byteLength === 0) {
      continue;
    }

    const ydoc = YDocManager.fromUpdate(bytes);
    const sourceLinkCount = renameReferencesInDoc(ydoc, noteId, newName);
    if (sourceLinkCount === 0) {
      continue;
    }

    await repository.writeFileBytes(sourceId, ydoc.encodeState());
    sourceCount++;
    linkCount += sourceLinkCount;
  }

  return { sourceCount, linkCount };
}
