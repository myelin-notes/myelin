import { Folder, Import, LayoutTemplate, Plus } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@myelin/ui/context-menu';
import type { VFSFolderNode } from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { createNewItemClass } from '../create-new-options';
import { folderIconStyle } from './folder-colors';
import {
  explorerGridBodyClass,
  explorerGridCardClass,
  explorerGridFadeMask,
  explorerGridMediaClass,
  explorerGridPlaceholderStyle,
  explorerGridTitleClass,
} from './grid/item-styles';

export function FolderGlyph({
  folder,
  className,
}: {
  folder: VFSFolderNode;
  className?: string;
}) {
  return isTemplatesRoot(folder) ? (
    <TemplatesGlyph className={className} />
  ) : (
    <Folder className={className} style={folderIconStyle(folder.color)} />
  );
}

function TemplatesGlyph({ className }: { className?: string }) {
  return (
    <LayoutTemplate
      className={cn(className, 'text-emerald-600 dark:text-accent')}
    />
  );
}

/** The templates root is stored under a dotfile name; users see it as "Templates". */
export function useFolderLabel(folder: VFSFolderNode): string {
  const strings = useMessages();
  return isTemplatesRoot(folder)
    ? strings.library.templates.title
    : folder.name;
}

export interface TemplatesFolderMenuProps {
  onNewTemplate: () => void;
  onImportTemplate: () => void;
}

export function TemplatesFolderMenu({
  onNewTemplate,
  onImportTemplate,
}: TemplatesFolderMenuProps) {
  const strings = useMessages();
  return (
    <ContextMenuContent className="min-w-[180px] rounded-xl bg-page p-1.5 shadow-ambient">
      <ContextMenuItem className={createNewItemClass} onClick={onNewTemplate}>
        <Plus className="size-4" />
        {strings.library.templates.newTemplate}
      </ContextMenuItem>
      <ContextMenuItem
        className={createNewItemClass}
        onClick={onImportTemplate}
      >
        <Import className="size-4" />
        {strings.library.templates.importTemplate}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Stands in for the templates folder until it exists; it is created on first use, not on load,
 * so a device that hasn't synced yet can't add a second templates folder. */
export function TemplatesPlaceholderItem({
  grid,
  onOpen,
  ...menuProps
}: TemplatesFolderMenuProps & { grid: boolean; onOpen: () => void }) {
  const strings = useMessages();
  const label = strings.library.templates.title;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            onClick={onOpen}
            aria-label={label}
            className={
              grid
                ? explorerGridCardClass
                : 'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 hover:bg-hover-tint'
            }
          />
        }
      >
        {grid ? (
          <>
            <div
              className={explorerGridMediaClass}
              style={explorerGridFadeMask}
            >
              <div
                className="absolute inset-0 opacity-95"
                style={explorerGridPlaceholderStyle}
              />
              <div className="relative flex h-full items-center justify-center">
                <div className="flex size-[4.75rem] items-center justify-center rounded-2xl bg-card/80 shadow-elevated backdrop-blur-sm transition-transform duration-300 group-hover:scale-[1.03]">
                  <TemplatesGlyph className="size-12 shrink-0" />
                </div>
              </div>
            </div>
            <div className={explorerGridBodyClass}>
              <span className={cn('block', explorerGridTitleClass)}>
                {label}
              </span>
            </div>
          </>
        ) : (
          <>
            <TemplatesGlyph className="size-4 shrink-0" />
            <span className="truncate font-medium text-sm text-text-primary">
              {label}
            </span>
          </>
        )}
      </ContextMenuTrigger>
      <TemplatesFolderMenu {...menuProps} />
    </ContextMenu>
  );
}
