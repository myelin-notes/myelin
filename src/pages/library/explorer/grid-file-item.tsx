import { useState } from 'react';
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
              className="group relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl bg-surface text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-card hover:shadow-ambient"
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
                  'h-full w-full object-cover object-top transition-opacity duration-500 ease-out',
                  imgLoaded ? 'opacity-100' : 'opacity-0',
                )}
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  backgroundImage:
                    'radial-gradient(circle, rgba(28, 39, 56, 0.12) 1px, transparent 1px)',
                  backgroundSize: '14px 14px',
                }}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 px-3 py-3">
            {renaming ? (
              <input
                {...renameInputProps}
                className="w-full border-primary border-b-2 bg-transparent font-normal text-sm text-text-primary outline-none"
              />
            ) : (
              <>
                <span
                  className="block truncate font-normal text-sm text-text-secondary transition-colors duration-200 group-hover:text-text-primary"
                  title={file.name}
                >
                  {file.name}
                </span>
                {file.tags.length > 0 && (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
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
              </>
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
