import type { VFSFileNode } from '@/lib/sync';
import { FileNode } from './folder-tree';

interface FlatFileListProps {
  /** Section heading shown above the list. */
  title: string;
  files: VFSFileNode[];
  loading: boolean;
  /** Shown when the list is empty and not loading. */
  emptyLabel: string;
  /** Reload the source after a rename/move/delete from a row's context menu. */
  onChanged: () => void;
}

/**
 * A flat, scrollable list of openable files. Backs the Recent and Tags lenses
 * and the search-results view, where the hierarchical folder tree isn't shown.
 */
export function FlatFileList({
  title,
  files,
  loading,
  emptyLabel,
  onChanged,
}: FlatFileListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-4 pb-2 font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {loading ? (
          <div className="flex h-full items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
          </div>
        ) : files.length === 0 ? (
          <p className="px-3 py-2 text-text-muted text-xs italic">
            {emptyLabel}
          </p>
        ) : (
          files.map((file) => (
            <FileNode
              key={file.id}
              file={file}
              depth={0}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}
