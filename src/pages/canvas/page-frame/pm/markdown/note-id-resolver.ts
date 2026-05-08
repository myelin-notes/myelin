/**
 * Shared infrastructure for resolving note titles to ids in the page-frame
 * editor.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import type { EditorState, PluginView, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { VFSNodeId } from '@/lib/sync';

export interface NoteLinkRef {
  noteId: VFSNodeId | null;
  pageFrameId: string | null;
}

export type ResolveNoteLink = (title: string) => Promise<NoteLinkRef>;

export type CollectTitlesForResolution = (
  doc: PMNode,
  schema: Schema,
) => Iterable<string>;

export type BuildResolveTransaction = (
  state: EditorState,
  schema: Schema,
  refsByTitle: ReadonlyMap<string, NoteLinkRef>,
) => Transaction | null;

export async function buildResolvedTitleLookup(
  doc: PMNode,
  schema: Schema,
  collectTitles: CollectTitlesForResolution,
  resolveNoteLink: ResolveNoteLink,
): Promise<Map<string, NoteLinkRef>> {
  const titles = Array.from(new Set(collectTitles(doc, schema)));
  const refsByTitle = new Map<string, NoteLinkRef>();
  await Promise.all(
    titles.map(async (title) => {
      refsByTitle.set(title, await resolveNoteLink(title));
    }),
  );
  return refsByTitle;
}

interface TitleResolverViewOptions {
  schema: Schema;
  collectTitles: CollectTitlesForResolution;
  buildResolveTransaction: BuildResolveTransaction;
  resolveNoteLink?: ResolveNoteLink;
}

export function createTitleResolverView(
  view: EditorView,
  options: TitleResolverViewOptions,
): PluginView {
  const { schema, collectTitles, buildResolveTransaction, resolveNoteLink } =
    options;
  let lastDoc = view.state.doc;
  let requestId = 0;
  let destroyed = false;
  let currentView = view;

  async function resolve(): Promise<void> {
    if (!resolveNoteLink) {
      return;
    }

    const localId = ++requestId;
    const refsByTitle = await buildResolvedTitleLookup(
      currentView.state.doc,
      schema,
      collectTitles,
      resolveNoteLink,
    );

    if (destroyed || localId !== requestId) {
      return;
    }

    const tr = buildResolveTransaction(currentView.state, schema, refsByTitle);
    if (tr) {
      currentView.dispatch(tr);
    }
  }

  void resolve();

  return {
    update(nextView) {
      const docChanged = nextView.state.doc !== lastDoc;
      currentView = nextView;
      if (!docChanged) {
        return;
      }
      lastDoc = nextView.state.doc;
      void resolve();
    },
    destroy() {
      destroyed = true;
      requestId += 1;
    },
  };
}
