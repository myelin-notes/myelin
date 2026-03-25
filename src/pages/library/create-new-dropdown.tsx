import { Plus, FolderPlus, FilePlus, LayoutGrid } from "lucide-react";
import type { FileType } from "@/lib/utils/file-system";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const itemClass = "gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary";

interface CreateNewDropdownProps {
  onNewFolder?: () => void;
  onNewFile?: (title: string, type: FileType) => void;
}

export function CreateNewDropdown({ onNewFolder, onNewFile }: CreateNewDropdownProps) {

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg bg-accent-dark px-2.5 py-1 text-text-on-dark transition-colors hover:bg-accent-dark/90 cursor-pointer outline-none">
        <Plus className="size-3" strokeWidth={2.5} />
        <span className="text-xs font-medium">New</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[180px] rounded-lg bg-page p-1.5 shadow-lg ring-1 ring-border-subtle"
      >
        <DropdownMenuItem
          className={itemClass}
          onClick={() => onNewFolder?.()}
        >
          <FolderPlus className="size-4" />
          New Folder
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 bg-border-subtle" />
        <DropdownMenuItem
          className={itemClass}
          onClick={() => onNewFile?.("Untitled Document", "mdoc")}
        >
          <FilePlus className="size-4" />
          New Document
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => onNewFile?.("Untitled Canvas", "mcanvas")}
        >
          <LayoutGrid className="size-4" />
          New Canvas
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
