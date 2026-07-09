import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { ElementType } from '@myelin/editor/elements/element-type';
import { renameNoteLinkReferencesDoc } from '@myelin/editor/page-frame/pm/markdown/note-links';
import { schema } from '@myelin/editor/page-frame/pm/schema';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import {
  type DocRewriteRepository,
  rewriteDocReferencesInSources,
} from './rewrite-doc-references';
import type { NoteBacklink, Repository, VFSNodeId } from './types';

type NoteReferenceRepository = DocRewriteRepository &
  Pick<Repository, 'getBacklinks'>;

export interface RenameNoteReferencesResult {
  sourceCount: number;
  linkCount: number;
}

function renameReferencesInDoc(
  ydoc: YDocManager,
  noteId: VFSNodeId,
  newName: string,
): number {
  let linkCount = 0;

  ydoc.transact(() => {
    for (let i = 0; i < ydoc.elements.length; i++) {
      const yMap = ydoc.elements.get(i);
      if (yMap.get('type') !== ElementType.PAGE_FRAME) {
        continue;
      }

      const uuid = yMap.get('uuid');
      if (typeof uuid !== 'string') {
        continue;
      }

      const fragment = ydoc.getXmlFragment(uuid);
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
  noteId: VFSNodeId,
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

  return rewriteDocReferencesInSources(repository, sourceIds, (ydoc) =>
    renameReferencesInDoc(ydoc, noteId, newName),
  );
}
