import { useState } from "react";
import { Folder } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useExplorerItem } from "./use-explorer-item";
import { useDropTarget } from "./use-drop-target";
import { ItemContextMenu } from "./item-context-menu";
import { TagManageDialog } from "../tag-manage-dialog";

interface FolderItemProps {
  id: string;
  name: string;
  tags: string[];
  autoRename?: boolean;
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({ id, name, tags, autoRename, onNavigate, onMoved }: FolderItemProps) {
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  const {
    renaming,
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
  } = useExplorerItem({
    nodeId: id,
    name,
    onChanged: onMoved,
    initialRenaming: autoRename,
  });

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: id,
    onMoved,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              draggable={!renaming}
              onClick={() => {
                if (!renaming) onNavigate();
              }}
              onDragStart={handleDragStart}
              {...dropTargetProps}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 transition-shadow cursor-pointer ${
                dragOver
                  ? "bg-accent/15 ring-1 ring-accent/40"
                  : "hover:shadow-md"
              }`}
            />
          }
        >
          <Folder className="size-4 text-amber-400 fill-amber-400 shrink-0" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="text-sm font-medium text-text-primary bg-transparent border-b border-border-divider outline-none min-w-0 flex-1"
            />
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-text-primary truncate">{name}</span>
              {tags.length > 0 && (
                <div className="flex items-center gap-1 shrink-0">
                  {tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-tag/60 px-1.5 py-0.5 text-[9px] font-medium text-text-tag"
                    >
                      #{tag}
                    </span>
                  ))}
                  {tags.length > 2 && (
                    <span className="text-[9px] text-text-muted">
                      +{tags.length - 2}
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
        />
      </ContextMenu>
      <TagManageDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        nodeId={id}
        nodeName={name}
        onChanged={onMoved}
      />
    </>
  );
}
