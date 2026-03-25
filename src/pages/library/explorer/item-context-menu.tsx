import { Pencil, Trash2, FolderOpen } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

interface ItemContextMenuProps {
  onRename: () => void;
  onRemove: () => void;
  onReveal?: () => void;
}

export function ItemContextMenu({ onRename, onRemove, onReveal }: ItemContextMenuProps) {
  return (
    <ContextMenuContent className="min-w-[180px] rounded-lg bg-page p-1.5 shadow-lg ring-1 ring-border-subtle">
      <ContextMenuItem
        className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
        onClick={onRename}
      >
        <Pencil className="size-4" />
        Rename
      </ContextMenuItem>
      {onReveal && (
        <ContextMenuItem
          className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
          onClick={onReveal}
        >
          <FolderOpen className="size-4" />
          Reveal in File Manager
        </ContextMenuItem>
      )}
      <ContextMenuSeparator className="my-1 bg-border-subtle" />
      <ContextMenuItem
        className="gap-2.5 rounded-md px-3 py-2 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive focus:*:[svg]:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="size-4" />
        Remove
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
