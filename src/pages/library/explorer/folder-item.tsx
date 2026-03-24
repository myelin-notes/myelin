import { Folder } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useExplorerItem } from "./use-explorer-item";
import { useDropTarget } from "./use-drop-target";
import { ItemContextMenu } from "./item-context-menu";

interface FolderItemProps {
  name: string;
  currentPath: string[];
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({ name, currentPath, onNavigate, onMoved }: FolderItemProps) {
  const folderPath = [...currentPath, name];

  const {
    renaming,
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
  } = useExplorerItem({
    name,
    segments: folderPath,
    isDirectory: true,
    onChanged: onMoved,
  });

  const { dragOver, dropTargetProps } = useDropTarget({
    targetPath: folderPath,
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
            className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-shadow cursor-pointer ${
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
