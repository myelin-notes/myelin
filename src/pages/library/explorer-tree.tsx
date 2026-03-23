import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
} from "lucide-react";
import { FileSystem, MyelinFile } from "@/lib/utils/file-system";

function FileItem({ file, path }: { file: MyelinFile; path: string[] }) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/${file.type}/${path.join("/")}/${file.name}.${file.type}`)}
      className="flex w-full items-center gap-3 rounded px-4 py-2 hover:bg-surface/60 transition-colors cursor-pointer"
    >
      <FileText className="size-3 text-text-secondary shrink-0" />
      <span className="text-sm font-normal text-text-secondary">
        {file.name}
      </span>
    </button>
  );
}

function FolderItem({ name, path }: { name: string; path: string[] }) {
  const [open, setOpen] = useState(false);
  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<MyelinFile[]>([]);
  const [loaded, setLoaded] = useState(false);

  const childPath = [...path, name];

  const load = useCallback(async () => {
    if (loaded) return;
    try {
      const [dirs, fs] = await FileSystem.loadDirectory(childPath);
      setDirectories(dirs);
      setFiles(fs);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load directory:", err);
    }
  }, [loaded, childPath.join("/")]);

  function toggle() {
    if (!open) load();
    setOpen(!open);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-3 rounded px-4 py-3 hover:bg-surface/60 transition-colors cursor-pointer"
      >
        {open ? (
          <ChevronDown className="size-2.5 text-text-secondary shrink-0" />
        ) : (
          <ChevronRight className="size-2.5 text-text-secondary shrink-0" />
        )}
        <Folder className="size-4 text-amber-400 fill-amber-400 shrink-0" />
        <span className="text-sm font-medium text-text-primary">{name}</span>
      </button>

      {open && (
        <div className="ml-[26px] flex flex-col gap-1 border-l border-border-subtle pl-px">
          {directories.map((dir) => (
            <FolderItem key={dir} name={dir} path={childPath} />
          ))}
          {files.map((file) => (
            <FileItem key={file.name} file={file} path={childPath} />
          ))}
          {loaded && directories.length === 0 && files.length === 0 && (
            <span className="px-4 py-2 text-xs text-text-muted">Empty</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ExplorerTree() {
  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<MyelinFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [dirs, fs] = await FileSystem.loadDirectory(["Home"]);
        setDirectories(dirs);
        setFiles(fs);
      } catch (err) {
        console.error("Failed to load root directory:", err);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
      </div>
    );
  }

  return (
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
  );
}
