import { Fragment, memo } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type CreateNewActions,
  createNewItemClass,
  useCreateNewOptions,
} from './create-new-options';

interface CreateNewDropdownProps extends CreateNewActions {
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
  const options = useCreateNewOptions({
    onNewFolder,
    onNewFile,
    onImport,
    importDisabled,
  });

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
        {options.map(
          ({ id, label, icon: Icon, onClick, disabled, separatorAfter }) => (
            <Fragment key={id}>
              <DropdownMenuItem
                className={createNewItemClass}
                onClick={onClick}
                disabled={disabled}
              >
                <Icon className="size-4" />
                {label}
              </DropdownMenuItem>
              {separatorAfter && <DropdownMenuSeparator />}
            </Fragment>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
