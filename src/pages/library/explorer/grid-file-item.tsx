import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { IS_DEV } from '@/lib/env';
import { useRepository, type VFSFileNode } from '@/lib/sync';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';
import { TagManageDialog } from '../tag-manage-dialog';
import { ItemContextMenu } from './item-context-menu';
import { useExplorerItem } from './use-explorer-item';

interface Props {
  file: VFSFileNode;
  autoRename?: boolean;
  onChanged: () => Promise<void>;
}

export function GridFileItem({ file, autoRename, onChanged }: Props) {
  const repository = useRepository();
  const navigate = useNavigate();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const thumbUrl = useThumbnailUrl(file.id);
  const hasThumb = typeof thumbUrl === 'string';

  const {
    renaming,
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
  } = useExplorerItem({
    nodeId: file.id,
    name: file.name,
    onChanged,
    initialRenaming: autoRename,
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
                  navigate(`/${file.fileType}/${file.id}`);
                }
              }}
              onDragStart={handleDragStart}
              className="group relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl bg-surface text-left transition-all duration-200 hover:bg-card hover:shadow-ambient"
            />
          }
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden">
            {hasThumb ? (
              <img
                src={thumbUrl}
                alt=""
                aria-hidden
                onLoad={() => setImgLoaded(true)}
                className={cn(
                  'h-full w-full object-cover object-top transition-[opacity,transform] duration-500 ease-out group-hover:scale-[1.03]',
                  imgLoaded ? 'opacity-100' : 'opacity-0',
                )}
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, rgba(28, 39, 56, 0.12) 1px, transparent 1px)',
                  backgroundSize: '12px 12px',
                }}
              />
            )}
          </div>

          <div className="flex-none px-3 py-2.5">
            {renaming ? (
              <input
                {...renameInputProps}
                className="w-full border-primary border-b-2 bg-transparent font-medium text-[13px] text-text-primary outline-none"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <FileText className="size-3 shrink-0 text-text-muted transition-colors duration-200 group-hover:text-text-secondary" />
                <span
                  className="truncate font-medium text-[13px] text-text-secondary transition-colors duration-200 group-hover:text-text-primary"
                  title={file.name}
                >
                  {file.name}
                </span>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ItemContextMenu
          onRename={startRenaming}
          onRemove={handleRemove}
          onManageTags={() => setTagDialogOpen(true)}
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
    </>
  );
}
