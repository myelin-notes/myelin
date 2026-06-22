import { useState } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import { IS_DEV } from '@/lib/env';
import { openNote } from '@/lib/note/navigation';
import {
  type NodeSearchResult,
  useRepository,
  type VFSFileNode,
} from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { useThumbnailUrl } from '@/lib/use-thumbnail-url';
import { cn } from '@/lib/utils';
import { formatExplorerItemAccessibleName } from '../../accessibility-labels';
import { TagManageDialog } from '../../tag-manage-dialog';
import { ItemContextMenu } from '../item-context-menu';
import { RenameReferencesDialog } from '../rename-references-dialog';
import { SearchHighlight } from '../search-highlight';
import { useExplorerItem } from '../use-explorer-item';
import {
  explorerGridBodyClass,
  explorerGridCardClass,
  explorerGridFadeMask,
  explorerGridMediaClass,
  explorerGridPlaceholderStyle,
  explorerGridRenameInputClass,
  explorerGridSnippetClass,
  explorerGridTagClass,
  explorerGridTagOverflowClass,
  explorerGridTagsClass,
  explorerGridTitleClass,
} from './item-styles';

interface Props {
  file: VFSFileNode;
  searchMatch?: NodeSearchResult;
  autoRename?: boolean;
  onChanged: () => Promise<void>;
}

export function GridFileItem({
  file,
  searchMatch,
  autoRename,
  onChanged,
}: Props) {
  const repository = useRepository();
  const tabController = useTabController();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [loadedThumbUrl, setLoadedThumbUrl] = useState<string | null>(null);
  const thumbUrl = useThumbnailUrl(file.id);
  const hasThumb = typeof thumbUrl === 'string';
  const imgLoaded = hasThumb && loadedThumbUrl === thumbUrl;

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
              className={cn(explorerGridCardClass, dragging && 'opacity-40')}
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
                onLoad={() => setLoadedThumbUrl(thumbUrl)}
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
                  <SearchHighlight text={file.name} terms={matchedTerms} />
                </span>
                {snippet && (
                  <SearchHighlight
                    text={snippet}
                    terms={matchedTerms}
                    className={explorerGridSnippetClass}
                  />
                )}
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
