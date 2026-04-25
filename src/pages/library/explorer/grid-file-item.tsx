import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { IS_DEV } from '@/lib/env';
import { openNote } from '@/lib/note-navigation';
import { useRepository, type VFSFileNode } from '@/lib/sync';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';
import { TagManageDialog } from '../tag-manage-dialog';
import {
  explorerGridBodyClass,
  explorerGridCardClass,
  explorerGridFadeMask,
  explorerGridMediaClass,
  explorerGridPlaceholderStyle,
  explorerGridRenameInputClass,
  explorerGridTagClass,
  explorerGridTagOverflowClass,
  explorerGridTagsClass,
  explorerGridTitleClass,
} from './grid-item-styles';
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
                  openNote(navigate, file);
                }
              }}
              onDragStart={handleDragStart}
              className={explorerGridCardClass}
            />
          }
        >
          <div
            className={`pointer-events-none ${explorerGridMediaClass}`}
            style={explorerGridFadeMask}
          >
            <div
              className="absolute inset-0 opacity-90"
              style={explorerGridPlaceholderStyle}
            />
            {hasThumb && (
              <img
                src={thumbUrl}
                alt=""
                aria-hidden
                draggable={false}
                onLoad={() => setImgLoaded(true)}
                className={cn(
                  'relative h-full w-full object-cover object-top transition-opacity duration-500 ease-out',
                  imgLoaded ? 'opacity-100' : 'opacity-0',
                )}
              />
            )}
          </div>

          <div className={explorerGridBodyClass}>
            {renaming ? (
              <input
                {...renameInputProps}
                className={explorerGridRenameInputClass}
              />
            ) : (
              <>
                <span
                  className={cn('block', explorerGridTitleClass)}
                  title={file.name}
                >
                  {file.name}
                </span>
                {file.tags.length > 0 && (
                  <div className={explorerGridTagsClass}>
                    {file.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className={explorerGridTagClass}>
                        #{tag}
                      </span>
                    ))}
                    {file.tags.length > 2 && (
                      <span className={explorerGridTagOverflowClass}>
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
