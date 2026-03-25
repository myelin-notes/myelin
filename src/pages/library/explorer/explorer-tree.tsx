import { useEffect, useState, useCallback, useImperativeHandle } from "react";
import { FileSystem, VFSFileNode, VFSFolderNode } from "@/lib/utils/file-system";
import { FolderItem } from "./folder-item";
import { FileItem } from "./file-item";
import { useDropTarget } from "./use-drop-target";

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
}

interface ExplorerTreeProps {
  ref?: React.Ref<ExplorerTreeHandle>;
  currentFolderId: string | null;
  onNavigate: (folderId: string) => void;
}

export function ExplorerTree({ currentFolderId, onNavigate, ref }: ExplorerTreeProps) {
    const [directories, setDirectories] = useState<VFSFolderNode[]>([]);
    const [files, setFiles] = useState<VFSFileNode[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        const [dirs, fs] = await FileSystem.loadDirectory(currentFolderId);
        setDirectories(dirs);
        setFiles(fs);
      } catch (err) {
        console.error("Failed to load directory:", err);
      }
      setLoading(false);
    }, [currentFolderId]);

    useImperativeHandle(ref, () => ({ reload }), [reload]);

    useEffect(() => {
      reload();
    }, [reload]);

    const { dragOver, dropTargetProps } = useDropTarget({
      targetFolderId: currentFolderId,
      onMoved: reload,
    });

    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
        </div>
      );
    }

    return (
      <div
        {...dropTargetProps}
        className={`flex flex-col gap-1 rounded-xl min-h-[80px] transition-colors ${
          dragOver ? "bg-accent/10" : ""
        }`}
      >
        {directories.map((dir) => (
          <FolderItem
            key={dir.id}
            id={dir.id}
            name={dir.name}
            onNavigate={() => onNavigate(dir.id)}
            onMoved={reload}
          />
        ))}
        {files.map((file) => (
          <FileItem key={file.id} file={file} onChanged={reload} />
        ))}
        {directories.length === 0 && files.length === 0 && (
          <span className="px-4 py-3 text-sm text-text-muted">No files yet</span>
        )}
      </div>
    );
}
