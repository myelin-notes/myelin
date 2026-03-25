import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { FileSystem, VFSFileNode } from "@/lib/utils/file-system";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useExplorerItem } from "./use-explorer-item";
import { ItemContextMenu } from "./item-context-menu";

interface FileItemProps {
  file: VFSFileNode;
  onChanged: () => Promise<void>;
}

export function FileItem({ file, onChanged }: FileItemProps) {
  const navigate = useNavigate();

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
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            draggable={!renaming}
            onClick={() => {
              if (!renaming) navigate(`/${file.fileType}/${file.id}`);
            }}
            onDragStart={handleDragStart}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-2 transition-shadow hover:shadow-md cursor-pointer"
          />
        }
      >
        <FileText className="size-3 text-text-secondary shrink-0" />
        {renaming ? (
          <input
            {...renameInputProps}
            className="text-sm font-normal text-text-secondary bg-transparent border-b border-border-divider outline-none min-w-0 flex-1"
          />
        ) : (
          <span className="text-sm font-normal text-text-secondary">
            {file.name}
          </span>
        )}
      </ContextMenuTrigger>
      <ItemContextMenu
        onRename={startRenaming}
        onRemove={handleRemove}
        onReveal={async () => {
          const path = await FileSystem.getDiskPath(file.id);
          if (path) await revealItemInDir(path);
        }}
      />
    </ContextMenu>
  );
}
