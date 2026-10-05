import { Fragment } from 'react';
import { Plus } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@myelin/ui/context-menu';
import {
  type CreateNewActions,
  createNewItemClass,
  useCreateNewOptions,
} from '@/pages/library/create-new-options';

export function FolderCreateSubmenu(actions: CreateNewActions) {
  const strings = useMessages();
  const options = useCreateNewOptions(actions);

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger
        className={`${createNewItemClass} data-open:bg-surface data-open:text-text-primary`}
      >
        <Plus className="size-4" />
        {strings.library.createNew.button}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[180px] rounded-xl bg-page p-1.5 shadow-ambient">
        {options.map(
          ({ id, label, icon: Icon, onClick, disabled, separatorAfter }) => (
            <Fragment key={id}>
              <ContextMenuItem
                className={createNewItemClass}
                onClick={onClick}
                disabled={disabled}
              >
                <Icon className="size-4" />
                {label}
              </ContextMenuItem>
              {separatorAfter && <ContextMenuSeparator />}
            </Fragment>
          ),
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
