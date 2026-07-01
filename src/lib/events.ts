import type { VFSNodeId } from '@/lib/sync';

/** Custom DOM event fired after every ProseMirror transaction. */
export const PM_UPDATE_EVENT = 'pm-update';

export const NOTE_LINK_OPEN_REQUEST_EVENT = 'myelin:note-link-open-request';

export const CODE_BLOCK_EXTERNAL_SELECTION_EVENT =
  'myelin:code-block-external-selection';
export const CODE_BLOCK_CLEAR_SELECTION_EVENT =
  'myelin:code-block-clear-selection';

export const KEYBINDS_RESET_EVENT = 'keybinds-reset';

/**
 * Fired after nodes are deleted from the repository, carrying the ids of every
 * deleted file (recursive for folders). The tab layer listens so it can close
 * tabs whose document was deleted out from under them.
 */
export const NODES_DELETED_EVENT = 'myelin:nodes-deleted';

export interface NodesDeletedDetail {
  ids: VFSNodeId[];
}
