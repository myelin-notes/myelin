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

export function CreateNewContextMenuItems(actions: CreateNewActions) {
  const options = useCreateNewOptions(actions);
  return options.map(({ id, label, icon: Icon, onClick, choices, disabled }) =>
    choices ? (
      <ContextMenuSub key={id}>
        <ContextMenuSubTrigger
          className={`${createNewItemClass} data-open:bg-surface data-open:text-text-primary`}
          disabled={disabled}
        >
          <Icon className="size-4" />
          {label}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-h-80 min-w-[180px] overflow-y-auto rounded-xl bg-page p-1.5 shadow-ambient">
          {choices.map((choice, index) => (
            <Fragment key={choice.id}>
              <ContextMenuItem
                className={createNewItemClass}
                onClick={choice.onClick}
              >
                {choice.label}
              </ContextMenuItem>
              {index === 0 && <ContextMenuSeparator />}
            </Fragment>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    ) : (
      <ContextMenuItem
        key={id}
        className={createNewItemClass}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon className="size-4" />
        {label}
      </ContextMenuItem>
    ),
  );
}

export function FolderCreateSubmenu(actions: CreateNewActions) {
  const strings = useMessages();

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger
        className={`${createNewItemClass} data-open:bg-surface data-open:text-text-primary`}
      >
        <Plus className="size-4" />
        {strings.library.createNew.button}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[180px] rounded-xl bg-page p-1.5 shadow-ambient">
        <CreateNewContextMenuItems {...actions} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
