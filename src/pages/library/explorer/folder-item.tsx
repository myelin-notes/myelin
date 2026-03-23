import { useEffect, useState, useCallback, useRef, useContext } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { FileSystem, MyelinFile } from "@/lib/utils/file-system";
import { FileItem } from "./file-item";
import { ReloadContext } from "./explorer-tree";

export function FolderItem({ name, path }: { name: string; path: string[] }) {
  const [open, setOpen] = useState(false);
  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<MyelinFile[]>([]);
  const { generation } = useContext(ReloadContext);
  const loadedGeneration = useRef(-1);

  const childPath = [...path, name];
  const folderPath = childPath.join("/");

  const load = useCallback(async () => {
    try {
      const [dirs, fs] = await FileSystem.loadDirectory(childPath);
      setDirectories(dirs);
      setFiles(fs);
      loadedGeneration.current = generation;
    } catch (err) {
      console.error("Failed to load directory:", err);
    }
  }, [folderPath, generation]);

  useEffect(() => {
    if (open && loadedGeneration.current !== generation) {
      load();
    }
  }, [open, generation, load]);

  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        onClick={toggle}
        className="flex w-full items-center gap-3 rounded px-4 py-3 transition-colors hover:bg-surface/60 cursor-pointer"
      >
        {open ? (
          <ChevronDown className="size-2.5 text-text-secondary shrink-0" />
        ) : (
          <ChevronRight className="size-2.5 text-text-secondary shrink-0" />
        )}
        <Folder className="size-4 text-amber-400 fill-amber-400 shrink-0" />
        <span className="text-sm font-medium text-text-primary">{name}</span>
      </div>

      {open && (
        <div className="ml-4 flex flex-col gap-1 border-l border-border-subtle pl-px">
          {directories.map((dir) => (
            <FolderItem key={dir} name={dir} path={childPath} />
          ))}
          {files.map((file) => (
            <FileItem key={file.name} file={file} path={childPath} />
          ))}
          {directories.length === 0 && files.length === 0 && (
            <span className="px-4 py-2 text-xs text-text-muted">Empty</span>
          )}
        </div>
      )}
    </div>
  );
}
