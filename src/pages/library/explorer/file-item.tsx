import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { MyelinFile } from "@/lib/utils/file-system";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useExplorerItem } from "./use-explorer-item";
import { ItemContextMenu } from "./item-context-menu";

interface FileItemProps {
  file: MyelinFile;
  path: string[];
  onChanged: () => Promise<void>;
}

export function FileItem({ file, path, onChanged }: FileItemProps) {
  const navigate = useNavigate();
  const fullName = `${file.name}.${file.type}`;

  const {
    renaming,
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
  } = useExplorerItem({
    name: file.name,
    segments: [...path, fullName],
    isDirectory: false,
    onChanged,
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            draggable={!renaming}
            onClick={() => {
              if (!renaming) navigate(`/${file.type}/${path.join("/")}/${fullName}`);
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
      <ItemContextMenu onRename={startRenaming} onRemove={handleRemove} />
    </ContextMenu>
  );
}
