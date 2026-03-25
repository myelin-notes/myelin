import { Folder } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useExplorerItem } from "./use-explorer-item";
import { useDropTarget } from "./use-drop-target";
import { ItemContextMenu } from "./item-context-menu";

interface FolderItemProps {
  id: string;
  name: string;
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({ id, name, onNavigate, onMoved }: FolderItemProps) {
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
  });

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: id,
    onMoved,
  });

  return (
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
          <span className="text-sm font-medium text-text-primary">{name}</span>
        )}
      </ContextMenuTrigger>
      <ItemContextMenu onRename={startRenaming} onRemove={handleRemove} />
    </ContextMenu>
  );
}
