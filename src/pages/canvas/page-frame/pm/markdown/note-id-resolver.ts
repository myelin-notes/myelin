/**
 * Shared infrastructure for resolving note titles to ids in the page-frame
 * editor. Both note-link marks and note-embed nodes need the same async
 * lookup + dispatch flow; this module provides one implementation.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import type {
  EditorState,
  PluginView,
  Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export type ResolveNoteLinkId = (title: string) => Promise<string | null>;

export type CollectTitlesForResolution = (
  doc: PMNode,
  schema: Schema,
) => Iterable<string>;

export type BuildResolveTransaction = (
  state: EditorState,
  schema: Schema,
  noteIdsByTitle: ReadonlyMap<string, string | null>,
) => Transaction | null;

export async function buildResolvedTitleLookup(
  doc: PMNode,
  schema: Schema,
  collectTitles: CollectTitlesForResolution,
  resolveNoteLinkId: ResolveNoteLinkId,
): Promise<Map<string, string | null>> {
  const titles = Array.from(new Set(collectTitles(doc, schema)));
  const noteIdsByTitle = new Map<string, string | null>();
  await Promise.all(
    titles.map(async (title) => {
      noteIdsByTitle.set(title, await resolveNoteLinkId(title));
    }),
  );
  return noteIdsByTitle;
}

interface TitleResolverViewOptions {
  schema: Schema;
  collectTitles: CollectTitlesForResolution;
  buildResolveTransaction: BuildResolveTransaction;
  resolveNoteLinkId?: ResolveNoteLinkId;
}

export function createTitleResolverView(
  view: EditorView,
  options: TitleResolverViewOptions,
): PluginView {
  const { schema, collectTitles, buildResolveTransaction, resolveNoteLinkId } =
    options;
  let lastDoc = view.state.doc;
  let requestId = 0;
  let destroyed = false;
  let currentView = view;

  async function resolve(): Promise<void> {
    if (!resolveNoteLinkId) {
      return;
    }

    const localId = ++requestId;
    const noteIdsByTitle = await buildResolvedTitleLookup(
      currentView.state.doc,
      schema,
      collectTitles,
      resolveNoteLinkId,
    );

    if (destroyed || localId !== requestId) {
      return;
    }

    const tr = buildResolveTransaction(
      currentView.state,
      schema,
      noteIdsByTitle,
    );
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
