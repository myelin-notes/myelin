import { useEffect, useState, useCallback, useImperativeHandle, forwardRef, useRef } from "react";
import { FileSystem, MyelinFile } from "@/lib/utils/file-system";
import { join } from "@tauri-apps/api/path";
import { FolderItem } from "./folder-item";
import { FileItem } from "./file-item";

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
}

interface ExplorerTreeProps {
  currentPath: string[];
  onNavigate: (path: string[]) => void;
}

export const ExplorerTree = forwardRef<ExplorerTreeHandle, ExplorerTreeProps>(
  function ExplorerTree({ currentPath, onNavigate }, ref) {
    const [directories, setDirectories] = useState<string[]>([]);
    const [files, setFiles] = useState<MyelinFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [dragOver, setDragOver] = useState(false);
    const dragCountRef = useRef(0);

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

    const handleDragOver = (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/myelin-item")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    };

    const handleDragEnter = (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/myelin-item")) return;
      e.preventDefault();
      dragCountRef.current++;
      setDragOver(true);
    };

    const handleDragLeave = () => {
      dragCountRef.current--;
      if (dragCountRef.current === 0) setDragOver(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      dragCountRef.current = 0;
      setDragOver(false);

      const raw = e.dataTransfer.getData("application/myelin-item");
      if (!raw) return;

      const { segments } = JSON.parse(raw) as { segments: string[]; isDirectory: boolean };

      // Don't drop into the same directory it's already in
      if (segments.slice(0, -1).join("/") === currentPath.join("/")) return;

      try {
        const fromPath = await join(...segments);
        const toDir = await join(...currentPath);
        await FileSystem.moveItem(fromPath, toDir);
        reload();
      } catch (err) {
        console.error("Failed to move item:", err);
      }
    };

    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
        </div>
      );
    }

    return (
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
          <FileItem key={file.name} file={file} path={currentPath} />
        ))}
        {directories.length === 0 && files.length === 0 && (
          <span className="px-4 py-3 text-sm text-text-muted">No files yet</span>
        )}
      </div>
    );
  }
);
