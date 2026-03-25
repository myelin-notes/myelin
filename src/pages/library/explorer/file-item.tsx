import { useState } from "react";
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
import { TagManageDialog } from "../tag-manage-dialog";

interface FileItemProps {
  file: VFSFileNode;
  autoRename?: boolean;
  onChanged: () => Promise<void>;
}

export function FileItem({ file, autoRename, onChanged }: FileItemProps) {
  const navigate = useNavigate();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

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
                if (!renaming) navigate(`/${file.fileType}/${file.id}`);
              }}
              onDragStart={handleDragStart}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-2 transition-colors hover:bg-black/5 cursor-pointer"
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
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-normal text-text-secondary truncate">
                {file.name}
              </span>
              {file.tags.length > 0 && (
                <div className="flex items-center gap-1 shrink-0">
                  {file.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-tag/60 px-1.5 py-0.5 text-[9px] font-medium text-text-tag"
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
          onReveal={async () => {
            const path = await FileSystem.getDiskPath(file.id);
            if (path) await revealItemInDir(path);
          }}
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
