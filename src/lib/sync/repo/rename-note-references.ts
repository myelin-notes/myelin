import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import * as Y from 'yjs';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { renameNoteLinkReferencesDoc } from '@/pages/canvas/page-frame/pm/markdown/note-links';
import { schema } from '@/pages/canvas/page-frame/pm/schema';
import { createDocFromBytes } from './shared';
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
  doc: Y.Doc,
  noteId: FileId,
  newName: string,
): number {
  const elements = doc.getArray<Y.Map<unknown>>('elements');
  let linkCount = 0;

  doc.transact(() => {
    for (let i = 0; i < elements.length; i++) {
      const yMap = elements.get(i);
      if (yMap.get('type') !== ElementType.PAGE_FRAME) {
        continue;
      }

      const index = yMap.get('index');
      if (typeof index !== 'number') {
        continue;
      }

      const fragment = doc.getXmlFragment(`pf-${index}`);
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

    const doc = createDocFromBytes(bytes);
    const sourceLinkCount = renameReferencesInDoc(doc, noteId, newName);
    if (sourceLinkCount === 0) {
      continue;
    }

    await repository.writeFileBytes(sourceId, Y.encodeStateAsUpdate(doc));
    sourceCount++;
    linkCount += sourceLinkCount;
  }

  return { sourceCount, linkCount };
}
