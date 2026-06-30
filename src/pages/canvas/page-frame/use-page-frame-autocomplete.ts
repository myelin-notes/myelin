import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { PM_UPDATE_EVENT } from '@/lib/events';
import { useMessages } from '@/lib/i18n';
import {
  type MediaPathSearchSource,
  searchMediaPathAutocompleteItems,
} from './media-path/resolution';
import {
  type NoteLinkSearchSource,
  type PageFrameNameCache,
  searchNoteLinkAutocompleteItems,
} from './note-link/resolution';
import {
  PageFrameAutocompleteController,
  type PageFrameAutocompleteItem,
} from './pm/autocomplete';
import {
  type ActiveMediaPathAutocomplete,
  buildSelectMediaPathAutocompleteTransaction,
  findActiveMediaPathAutocomplete,
} from './pm/autocomplete/media-path';
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
  repository: NoteLinkSearchSource & MediaPathSearchSource;
  view: EditorView | null;
}

export type PageFrameAutocompleteKind = 'note-link' | 'slash' | 'media-path';

type ActiveAutocompleteRequest =
  | {
      kind: 'slash';
      request: ActiveSlashInsertAutocomplete;
    }
  | {
      kind: 'note-link';
      request: ActiveNoteLinkAutocomplete;
    }
  | {
      kind: 'media-path';
      request: ActiveMediaPathAutocomplete;
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

  const mediaPathRequest = findActiveMediaPathAutocomplete(state);
  if (mediaPathRequest) {
    return {
      kind: 'media-path',
      request: mediaPathRequest,
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
  const activeSourceRef = useRef<PageFrameAutocompleteKind | null>(null);
  const [activeKind, setActiveKind] =
    useState<PageFrameAutocompleteKind | null>(null);

  // Read inside the (memoized) source closure so language changes are picked up
  // without recreating the controller.
  const strings = useMessages();
  const slashLabelsRef = useRef(strings.canvas.slashInsert);
  slashLabelsRef.current = strings.canvas.slashInsert;
  const slashAllowBlockActionsRef = useRef(true);

  const frameNameCache = useMemo<PageFrameNameCache>(() => new Map(), []);

  const controller = useMemo(
    () =>
      new PageFrameAutocompleteController({
        source: ({ query, limit = 8, signal }) => {
          if (activeSourceRef.current === 'slash') {
            return searchSlashInsertAutocompleteItems(
              query,
              slashLabelsRef.current,
              slashAllowBlockActionsRef.current,
            );
          }

          if (activeSourceRef.current === 'media-path') {
            return searchMediaPathAutocompleteItems(
              repository,
              query,
              limit,
              signal,
            );
          }

          return searchNoteLinkAutocompleteItems(
            repository,
            query,
            limit,
            signal,
            frameNameCache,
          );
        },
      }),
    [repository, frameNameCache],
  );

  useEffect(() => () => controller.dispose(), [controller]);

  // Mirror controller open-state into React state so consumers can react to
  // which kind (if any) is currently active. The hook is the only layer that
  // knows about kinds; the controller stays generic.
  useEffect(() => {
    return controller.subscribe(() => {
      if (!controller.getState().open) {
        setActiveKind(null);
      }
    });
  }, [controller]);

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
          : activeRequest.kind === 'media-path'
            ? buildSelectMediaPathAutocompleteTransaction(
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
      setActiveKind(null);
      controller.close();
      return;
    }

    const activeRequest = findActiveAutocompleteRequest(view.state);
    if (!activeRequest) {
      activeSourceRef.current = null;
      setActiveKind(null);
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
    setActiveKind(activeRequest.kind);
    if (activeRequest.kind === 'slash') {
      slashAllowBlockActionsRef.current =
        activeRequest.request.allowBlockActions;
    }
    controller.show(activeRequest.request);
  });

  useEffect(() => {
    if (!view) {
      activeSourceRef.current = null;
      setActiveKind(null);
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
      setActiveKind(null);
      controller.close();
      view.dom.removeEventListener(PM_UPDATE_EVENT, handleUpdate);
      view.dom.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [controller, view]);

  return {
    controller: view ? controller : null,
    onSelectItem: applySelectedItem,
    activeKind: view ? activeKind : null,
  };
}
