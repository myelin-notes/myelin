import { useState } from 'react';
import { cn } from '@myelin/editor/utils';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import { IS_DEV } from '@/lib/env';
import { openNote } from '@/lib/note/navigation';
import {
  type NodeSearchResult,
  useRepository,
  type VFSFileNode,
} from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { formatExplorerItemAccessibleName } from '../accessibility-labels';
import { TagManageDialog } from '../tag-manage-dialog';
import { getFileTypeIcon } from './file-icon';
import { ItemContextMenu } from './item-context-menu';
import { RenameReferencesDialog } from './rename-references-dialog';
import { SearchHighlight } from './search-highlight';
import { TagList } from './tag-list';
import { useExplorerItem } from './use-explorer-item';

interface FileItemProps {
  file: VFSFileNode;
  searchMatch?: NodeSearchResult;
  autoRename?: boolean;
  onChanged: () => Promise<void>;
}

export function FileItem({
  file,
  searchMatch,
  autoRename,
  onChanged,
}: FileItemProps) {
  const repository = useRepository();
  const tabController = useTabController();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const {
    renaming,
    dragging,
    startRenaming,
    handleRemove,
    handleDragStart,
    handleDragEnd,
    renameInputProps,
    renameReferencesPrompt,
    chooseRenameReferences,
  } = useExplorerItem({
    nodeId: file.id,
    name: file.name,
    dragKind: 'file',
    onChanged,
    initialRenaming: autoRename,
    renameReferencesOnRename: file.fileType === 'mcanvas',
  });

  const FileIcon = getFileTypeIcon(file.fileType);
  const matchedTerms = searchMatch?.matchedTerms ?? [];
  const snippet = searchMatch?.contentSnippet ?? null;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              draggable={!renaming}
              onClick={() => {
                if (!renaming) {
                  openNote(tabController, file, file.name, 'explorer');
                }
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(file.name, file.tags)
              }
              className={cn(
                'group flex w-full cursor-pointer gap-3 rounded-lg px-4 py-2 transition-all duration-200 hover:bg-hover-tint',
                snippet ? 'items-start' : 'items-center',
                dragging && 'opacity-40',
              )}
            />
          }
        >
          <FileIcon
            className={cn(
              'size-3 shrink-0 text-text-muted transition-colors duration-200 group-hover:text-text-secondary',
              snippet && 'mt-1',
            )}
          />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b-2 bg-transparent font-normal text-sm text-text-secondary outline-none"
            />
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-normal text-sm text-text-secondary transition-colors duration-200 group-hover:text-text-primary">
                  <SearchHighlight text={file.name} terms={matchedTerms} />
                </span>
                <TagList
                  tags={file.tags}
                  className="flex shrink-0 items-center gap-1"
                  tagClassName="rounded-md bg-tag/60 px-1.5 py-0.5 font-medium text-[9px] text-text-tag"
                  overflowClassName="text-[9px] text-text-muted"
                />
              </div>
              {snippet && (
                <SearchHighlight
                  text={snippet}
                  terms={matchedTerms}
                  className="line-clamp-1 text-text-muted text-xs leading-snug"
                />
              )}
            </div>
          )}
        </ContextMenuTrigger>
        <ItemContextMenu
          onRename={startRenaming}
          onRemove={handleRemove}
          onManageTags={() => setTagDialogOpen(true)}
          onVersionHistory={() => setVersionHistoryOpen(true)}
          onReveal={
            IS_DEV
              ? async () => {
                  const path = await repository.getRevealPath(file.id);
                  if (path) {
                    await revealItemInDir(path);
                  }
                }
              : undefined
          }
        />
      </ContextMenu>
      <TagManageDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        nodeId={file.id}
        nodeName={file.name}
        onChanged={onChanged}
      />
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        fileId={file.id}
        fileName={file.name}
        fileType={file.fileType}
        onRestored={onChanged}
      />
      <RenameReferencesDialog
        prompt={renameReferencesPrompt}
        onChoice={chooseRenameReferences}
      />
    </>
  );
}
