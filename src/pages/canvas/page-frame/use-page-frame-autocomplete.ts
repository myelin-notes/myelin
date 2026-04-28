import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { PM_UPDATE_EVENT } from '@/lib/events';
import {
  type NoteLinkSearchSource,
  searchNoteLinkAutocompleteItems,
} from './note-link-resolution';
import {
  PageFrameAutocompleteController,
  type PageFrameAutocompleteItem,
} from './pm/autocomplete';
import {
  type ActiveNoteLinkAutocomplete,
  buildSelectNoteLinkAutocompleteTransaction,
  findActiveNoteLinkAutocomplete,
  hasSameAutocompleteRequest,
} from './pm/autocomplete/note-link';
import {
  type ActiveSlashInsertAutocomplete,
  buildSelectSlashInsertAutocompleteTransaction,
  findActiveSlashInsertAutocomplete,
  searchSlashInsertAutocompleteItems,
} from './pm/autocomplete/slash-insert';
import { schema } from './pm/schema';

interface UsePageFrameAutocompleteArgs {
  repository: NoteLinkSearchSource;
  view: EditorView | null;
}

type AutocompleteSourceKind = 'note-link' | 'slash' | null;
type ActiveAutocompleteRequest =
  | {
      kind: 'slash';
      request: ActiveSlashInsertAutocomplete;
    }
  | {
      kind: 'note-link';
      request: ActiveNoteLinkAutocomplete;
    };

function findActiveAutocompleteRequest(
  state: EditorState,
): ActiveAutocompleteRequest | null {
  const slashRequest = findActiveSlashInsertAutocomplete(state);
  if (slashRequest) {
    return {
      kind: 'slash',
      request: slashRequest,
    };
  }

  const noteLinkRequest = findActiveNoteLinkAutocomplete(state);
  if (noteLinkRequest) {
    return {
      kind: 'note-link',
      request: noteLinkRequest,
    };
  }

  return null;
}

export function usePageFrameAutocomplete({
  repository,
  view,
}: UsePageFrameAutocompleteArgs) {
  const activeSourceRef = useRef<AutocompleteSourceKind>(null);

  const controller = useMemo(
    () =>
      new PageFrameAutocompleteController({
        source: ({ query, limit = 8, signal }) => {
          if (activeSourceRef.current === 'slash') {
            return searchSlashInsertAutocompleteItems(query, limit);
          }

          return searchNoteLinkAutocompleteItems(
            repository,
            query,
            limit,
            signal,
          );
        },
      }),
    [repository],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  const applySelectedItem = useEffectEvent(
    (item: PageFrameAutocompleteItem) => {
      if (!view) {
        return;
      }

      const activeRequest = findActiveAutocompleteRequest(view.state);
      if (!activeRequest) {
        return;
      }

      const tr =
        activeRequest.kind === 'slash'
          ? buildSelectSlashInsertAutocompleteTransaction(
              view.state,
              schema,
              activeRequest.request,
              item,
            )
          : buildSelectNoteLinkAutocompleteTransaction(
              view.state,
              schema,
              activeRequest.request,
              item,
            );

      if (!tr) {
        return;
      }

      view.dispatch(tr);
      view.focus();
    },
  );

  const syncAutocomplete = useEffectEvent(() => {
    if (!view) {
      activeSourceRef.current = null;
      controller.close();
      return;
    }

    const activeRequest = findActiveAutocompleteRequest(view.state);
    if (!activeRequest) {
      activeSourceRef.current = null;
      if (controller.getState().open) {
        controller.close();
      }
      return;
    }

    const current = controller.getState();
    const currentRequest = current.range
      ? {
          query: current.query,
          range: current.range,
          anchorPosition: current.anchorPosition ?? undefined,
        }
      : null;

    if (
      current.open &&
      activeSourceRef.current === activeRequest.kind &&
      hasSameAutocompleteRequest(currentRequest, activeRequest.request)
    ) {
      return;
    }

    activeSourceRef.current = activeRequest.kind;
    controller.show({ ...activeRequest.request, kind: activeRequest.kind });
  });

  useEffect(() => {
    if (!view) {
      activeSourceRef.current = null;
      controller.close();
      return;
    }

    const handleUpdate = () => {
      syncAutocomplete();
    };
    const handleSelectionChange = () => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        view.dom.contains(activeElement)
      ) {
        syncAutocomplete();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const result = controller.handleKeyDown(event);
      if (!result.handled) {
        return;
      }
      if (result.action === 'select') {
        applySelectedItem(result.item);
      }
    };

    view.dom.addEventListener(PM_UPDATE_EVENT, handleUpdate);
    view.dom.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    syncAutocomplete();

    return () => {
      activeSourceRef.current = null;
      controller.close();
      view.dom.removeEventListener(PM_UPDATE_EVENT, handleUpdate);
      view.dom.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [controller, view]);

  return {
    controller: view ? controller : null,
    onSelectItem: applySelectedItem,
  };
}
