import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import { IS_DEV } from '@/lib/env';
import { openNote } from '@/lib/note-navigation';
import { useRepository, type VFSFileNode } from '@/lib/sync';
import { formatExplorerItemAccessibleName } from '../accessibility-labels';
import { TagManageDialog } from '../tag-manage-dialog';
import { ItemContextMenu } from './item-context-menu';
import { RenameReferencesDialog } from './rename-references-dialog';
import { useExplorerItem } from './use-explorer-item';

interface FileItemProps {
  file: VFSFileNode;
  autoRename?: boolean;
  onChanged: () => Promise<void>;
}

export function FileItem({ file, autoRename, onChanged }: FileItemProps) {
  const repository = useRepository();
  const navigate = useNavigate();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const {
    renaming,
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
    renameReferencesPrompt,
    chooseRenameReferences,
  } = useExplorerItem({
    nodeId: file.id,
    name: file.name,
    onChanged,
    initialRenaming: autoRename,
    renameReferencesOnRename: file.fileType === 'mcanvas',
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              draggable={!renaming}
              onClick={() => {
                if (!renaming) {
                  openNote(navigate, file);
                }
              }}
              onDragStart={handleDragStart}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(file.name, file.tags)
              }
              className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-2 transition-all duration-200 hover:bg-hover-tint"
            />
          }
        >
          <FileText className="size-3 shrink-0 text-text-muted transition-colors duration-200 group-hover:text-text-secondary" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b-2 bg-transparent font-normal text-sm text-text-secondary outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-normal text-sm text-text-secondary transition-colors duration-200 group-hover:text-text-primary">
                {file.name}
              </span>
              {file.tags.length > 0 && (
                <div className="flex shrink-0 items-center gap-1">
                  {file.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-tag/60 px-1.5 py-0.5 font-medium text-[9px] text-text-tag"
                    >
                      #{tag}
                    </span>
                  ))}
                  {file.tags.length > 2 && (
                    <span className="text-[9px] text-text-muted">
                      +{file.tags.length - 2}
                    </span>
                  )}
                </div>
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
