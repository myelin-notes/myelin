import { useEffect, useEffectEvent, useMemo } from 'react';
import type { EditorView } from 'prosemirror-view';
import {
  type NoteLinkSearchSource,
  searchNoteLinkAutocompleteItems,
} from './note-link-resolution';
import {
  PageFrameAutocompleteController,
  type PageFrameAutocompleteItem,
} from './pm/autocomplete';
import { PM_UPDATE_EVENT } from './pm/constants';
import {
  buildSelectNoteLinkAutocompleteTransaction,
  findActiveNoteLinkAutocomplete,
  hasSameAutocompleteRequest,
} from './pm/note-link-autocomplete';
import { schema } from './pm/schema';

interface UseNoteLinkAutocompleteArgs {
  repository: NoteLinkSearchSource;
  view: EditorView | null;
}

export function useNoteLinkAutocomplete({
  repository,
  view,
}: UseNoteLinkAutocompleteArgs) {
  const controller = useMemo(
    () =>
      new PageFrameAutocompleteController({
        source: ({ query, limit = 8, signal }) =>
          searchNoteLinkAutocompleteItems(repository, query, limit, signal),
      }),
    [repository],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  const applySelectedItem = useEffectEvent(
    (item: PageFrameAutocompleteItem) => {
      if (!view) {
        return;
      }

      const activeRequest = findActiveNoteLinkAutocomplete(view.state);
      if (!activeRequest) {
        return;
      }

      const tr = buildSelectNoteLinkAutocompleteTransaction(
        view.state,
        schema,
        activeRequest,
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
      controller.close();
      return;
    }

    const request = findActiveNoteLinkAutocomplete(view.state);
    if (!request) {
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

    if (current.open && hasSameAutocompleteRequest(currentRequest, request)) {
      return;
    }

    controller.show(request);
  });

  useEffect(() => {
    if (!view) {
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
      controller.close();
      view.dom.removeEventListener(PM_UPDATE_EVENT, handleUpdate);
      view.dom.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [applySelectedItem, controller, syncAutocomplete, view]);

  return {
    controller: view ? controller : null,
    onSelectItem: applySelectedItem,
  };
}
