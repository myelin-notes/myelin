import type { NavigateFunction } from 'react-router-dom';
import type { FileType } from '@/lib/sync';

export interface NoteRouteTarget {
  fileType: FileType;
  id: string;
}

export function getNotePath({ fileType, id }: NoteRouteTarget): string {
  return `/${fileType}/${id}`;
}

export function openNote(
  navigate: NavigateFunction,
  target: NoteRouteTarget,
): void {
  navigate(getNotePath(target), { viewTransition: true });
}
