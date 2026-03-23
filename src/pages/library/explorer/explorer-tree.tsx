import { useEffect, useState, useCallback, useImperativeHandle, forwardRef, createContext } from "react";
import { FileSystem, MyelinFile } from "@/lib/utils/file-system";
import { FolderItem } from "./folder-item";
import { FileItem } from "./file-item";

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
}

export const ReloadContext = createContext<{ generation: number; bump: () => void }>({
  generation: 0,
  bump: () => {},
});

export const ExplorerTree = forwardRef<ExplorerTreeHandle>(function ExplorerTree(_, ref) {
  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<MyelinFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);

  const bump = useCallback(() => setGeneration((g) => g + 1), []);

  const reload = useCallback(async () => {
    try {
      const [dirs, fs] = await FileSystem.loadDirectory(["Home"]);
      setDirectories(dirs);
      setFiles(fs);
    } catch (err) {
      console.error("Failed to load root directory:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (generation > 0) reload();
  }, [generation, reload]);

  useImperativeHandle(ref, () => ({ reload }), [reload]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
      </div>
    );
  }

  return (
    <ReloadContext.Provider value={{ generation, bump }}>
      <div className="flex flex-col gap-1">
        {directories.map((dir) => (
          <FolderItem key={dir} name={dir} path={["Home"]} />
        ))}
        {files.map((file) => (
          <FileItem key={file.name} file={file} path={["Home"]} />
        ))}
        {directories.length === 0 && files.length === 0 && (
          <span className="px-4 py-3 text-sm text-text-muted">No files yet</span>
        )}
      </div>
    </ReloadContext.Provider>
  );
});
