import { memo } from 'react';
import {
  ChevronDown,
  FolderPlus,
  Import,
  LayoutGrid,
  Plus,
} from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileType } from '@/lib/sync';

const itemClass =
  'gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary';

interface CreateNewDropdownProps {
  onNewFolder?: () => void;
  onNewFile?: (title: string, type: FileType) => void;
  onImport?: () => void;
  importDisabled?: boolean;
  labeled?: boolean;
}

export const CreateNewDropdown = memo(function CreateNewDropdown({
  onNewFolder,
  onNewFile,
  onImport,
  importDisabled = false,
  labeled = false,
}: CreateNewDropdownProps) {
  const strings = useMessages();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={strings.library.createNew.button}
        title={strings.library.createNew.button}
        className={cn(
          'flex cursor-pointer items-center justify-center outline-none transition-colors duration-150',
          labeled
            ? 'h-9 gap-1.5 rounded-xl bg-gradient-to-b from-primary to-primary-container px-3 font-medium text-primary-foreground text-sm hover:shadow-sm hover:brightness-110 active:translate-y-px active:brightness-95'
            : 'size-6 rounded-md text-text-secondary hover:bg-hover-tint hover:text-text-primary',
        )}
      >
        <Plus className={labeled ? 'size-4' : 'size-3.5'} />
        {labeled && (
          <>
            <span>{strings.library.createNew.button}</span>
            <ChevronDown className="size-3.5 opacity-75" />
          </>
        )}
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
          disabled={importDisabled}
          onClick={() => onImport?.()}
        >
          <Import className="size-4" />
          {strings.library.createNew.import}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
