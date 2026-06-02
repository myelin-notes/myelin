export type { NoteIndexRecord } from './cache';
export type { ReindexItem } from './service';
export {
  getIndexContent,
  initNoteIndex,
  removeIndex,
  requestReindex,
  startBackfill,
  subscribeIndex,
} from './service';
