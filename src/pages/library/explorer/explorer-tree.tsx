import { useEffect, useState, useCallback, useImperativeHandle } from "react";
import { FileSystem, MyelinFile } from "@/lib/utils/file-system";
import { FolderItem } from "./folder-item";
import { FileItem } from "./file-item";
import { useDropTarget } from "./use-drop-target";

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
}

interface ExplorerTreeProps {
  ref?: React.Ref<ExplorerTreeHandle>;
  currentPath: string[];
  onNavigate: (path: string[]) => void;
}

export function ExplorerTree({ currentPath, onNavigate, ref }: ExplorerTreeProps) {
    const [directories, setDirectories] = useState<string[]>([]);
    const [files, setFiles] = useState<MyelinFile[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        const [dirs, fs] = await FileSystem.loadDirectory(currentPath);
        setDirectories(dirs);
        setFiles(fs);
      } catch (err) {
        console.error("Failed to load directory:", err);
      }
      setLoading(false);
    }, [currentPath.join("/")]);

    useImperativeHandle(ref, () => ({ reload }), [reload]);

    useEffect(() => {
      reload();
    }, [reload]);

    const { dragOver, dropTargetProps } = useDropTarget({
      targetPath: currentPath,
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
        className={`flex flex-col gap-1 rounded-lg min-h-[80px] transition-colors ${
          dragOver ? "bg-accent/10" : ""
        }`}
      >
        {directories.map((dir) => (
          <FolderItem
            key={dir}
            name={dir}
            currentPath={currentPath}
            onNavigate={() => onNavigate([...currentPath, dir])}
            onMoved={reload}
          />
        ))}
        {files.map((file) => (
          <FileItem key={file.name} file={file} path={currentPath} onChanged={reload} />
        ))}
        {directories.length === 0 && files.length === 0 && (
          <span className="px-4 py-3 text-sm text-text-muted">No files yet</span>
        )}
      </div>
    );
}
