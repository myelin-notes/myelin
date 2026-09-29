import { useSyncExternalStore } from 'react';
import { noteContentIndex } from './note-content-index';

export function useNoteIndexStatus() {
  return useSyncExternalStore(
    noteContentIndex.subscribe,
    noteContentIndex.getStatus,
    noteContentIndex.getStatus,
  );
}
