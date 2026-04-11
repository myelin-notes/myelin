/** Custom DOM event fired after every ProseMirror transaction. */
export const PM_UPDATE_EVENT = 'pm-update';

/** CSS class applied to ProseMirror editor containers. */
export const PM_EDITOR_CLASS = 'pm-editor';

/**
 * Transaction meta key checked by prosemirror-history to skip undo recording.
 * @see https://prosemirror.net/docs/ref/#history
 */
export const PM_ADD_TO_HISTORY = 'addToHistory';
