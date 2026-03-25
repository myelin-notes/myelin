import { useEffect, useState, useCallback, useImperativeHandle } from "react";
import { FileSystem, VFSNode } from "@/lib/utils/file-system";
import { FolderItem } from "./folder-item";
import { FileItem } from "./file-item";
import { useDropTarget } from "./use-drop-target";

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
}

interface ExplorerTreeProps {
  ref?: React.Ref<ExplorerTreeHandle>;
  currentFolderId: string | null;
  onNavigate: (folderId: string) => void;
  onTagsChanged?: () => void;
  filterTags?: string[];
}

export function ExplorerTree({ currentFolderId, onNavigate, ref, onTagsChanged, filterTags }: ExplorerTreeProps) {
    const [nodes, setNodes] = useState<VFSNode[]>([]);
    const [loading, setLoading] = useState(true);
    const isFiltering = filterTags && filterTags.length > 0;

    const reload = useCallback(async () => {
      setLoading(true);
      try {
        if (isFiltering) {
          const manifest = await FileSystem.getManifest();
          setNodes(FileSystem.getNodesByAnyTag(manifest, filterTags));
        } else {
          const [dirs, files] = await FileSystem.loadDirectory(currentFolderId);
          setNodes([...dirs, ...files]);
        }
      } catch (err) {
        console.error("Failed to load directory:", err);
      }
      setLoading(false);
    }, [currentFolderId, isFiltering, filterTags]);

    const startNewFolder = useCallback(async () => {
      const name = await FileSystem.getUniqueFileName("Unnamed Folder", currentFolderId);
      await FileSystem.createFolder(name, currentFolderId);
      await reload();
      onTagsChanged?.();
    }, [currentFolderId, reload, onTagsChanged]);

    useImperativeHandle(ref, () => ({ reload, startNewFolder }), [reload, startNewFolder]);

    useEffect(() => {
      reload();
    }, [reload]);

    const reloadAndNotify = useCallback(async () => {
      await reload();
      onTagsChanged?.();
    }, [reload, onTagsChanged]);

    const { dragOver, dropTargetProps } = useDropTarget({
      targetFolderId: currentFolderId,
      onMoved: reloadAndNotify,
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
        {...(isFiltering ? {} : dropTargetProps)}
        className={`flex flex-col gap-1 rounded-xl min-h-[80px] transition-colors ${
          dragOver && !isFiltering ? "bg-accent/10" : ""
        }`}
      >
        {nodes.map((node) =>
          node.type === 'folder' ? (
            <FolderItem
              key={node.id}
              id={node.id}
              name={node.name}
              tags={node.tags}
              onNavigate={() => onNavigate(node.id)}
              onMoved={reloadAndNotify}
            />
          ) : (
            <FileItem key={node.id} file={node} onChanged={reloadAndNotify} />
          )
        )}
        {nodes.length === 0 && (
          <span className="px-4 py-3 text-sm text-text-muted">
            {isFiltering ? "No items match the selected tags" : "No files yet"}
          </span>
        )}
      </div>
    );
}
