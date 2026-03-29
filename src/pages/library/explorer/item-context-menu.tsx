import { FolderOpen, Pencil, Tag, Trash2 } from 'lucide-react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

interface ItemContextMenuProps {
  onRename: () => void;
  onRemove: () => void;
  onReveal?: () => void;
  onManageTags?: () => void;
}

export function ItemContextMenu({
  onRename,
  onRemove,
  onReveal,
  onManageTags,
}: ItemContextMenuProps) {
  return (
    <ContextMenuContent className="min-w-[180px] rounded-xl bg-page p-1.5 shadow-ambient">
      <ContextMenuItem
        className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
        onClick={onRename}
      >
        <Pencil className="size-4" />
        Rename
      </ContextMenuItem>
      {onManageTags && (
        <ContextMenuItem
          className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
          onClick={onManageTags}
        >
          <Tag className="size-4" />
          Manage Tags
        </ContextMenuItem>
      )}
      {onReveal && (
        <ContextMenuItem
          className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
          onClick={onReveal}
        >
          <FolderOpen className="size-4" />
          Reveal in File Manager
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        className="gap-2.5 rounded-md px-3 py-2 text-destructive text-sm focus:bg-destructive/10 focus:text-destructive focus:*:[svg]:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
        Remove
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
