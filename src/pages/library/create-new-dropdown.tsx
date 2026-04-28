import { FileText, FolderPlus, Import, LayoutGrid, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMessages } from '@/lib/i18n';
import type { FileType } from '@/lib/sync';

const itemClass =
  'gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary';

interface CreateNewDropdownProps {
  onNewFolder?: () => void;
  onNewFile?: (title: string, type: FileType) => void;
  onImportFiles?: () => void;
  onImportMarkdown?: () => void;
}

export function CreateNewDropdown({
  onNewFolder,
  onNewFile,
  onImportFiles,
  onImportMarkdown,
}: CreateNewDropdownProps) {
  const strings = useMessages();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1.5 rounded-md bg-accent-dark px-2.5 py-1 text-text-on-dark outline-none transition-colors hover:bg-accent-dark/90">
        <Plus className="size-3" />
        <span className="font-medium text-xs">
          {strings.library.createNew.button}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[180px] rounded-xl bg-page p-1.5 shadow-ambient"
      >
        <DropdownMenuItem className={itemClass} onClick={() => onNewFolder?.()}>
          <FolderPlus className="size-4" />
          {strings.library.createNew.folder}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={itemClass}
          onClick={() =>
            onNewFile?.(strings.library.createNew.untitledCanvas, 'mcanvas')
          }
        >
          <LayoutGrid className="size-4" />
          {strings.library.createNew.canvas}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => onImportMarkdown?.()}
        >
          <FileText className="size-4" />
          {strings.library.createNew.importMarkdown}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => onImportFiles?.()}
        >
          <Import className="size-4" />
          {strings.library.createNew.importFiles}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
