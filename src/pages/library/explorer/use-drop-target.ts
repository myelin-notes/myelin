import { useState, useRef } from "react";
import { FileSystem } from "@/lib/utils/file-system";
import { join } from "@tauri-apps/api/path";

interface UseDropTargetOptions {
  targetPath: string[];
  onMoved: () => void;
}

export function useDropTarget({ targetPath, onMoved }: UseDropTargetOptions) {
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

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

    // Don't drop onto self or into current parent
    if (segments.join("/") === targetPath.join("/")) return;
    if (segments.slice(0, -1).join("/") === targetPath.join("/")) return;

    try {
      const fromPath = await join(...segments);
      const toDir = await join(...targetPath);
      await FileSystem.moveItem(fromPath, toDir);
      onMoved();
    } catch (err) {
      console.error("Failed to move item:", err);
    }
  };

  return {
    dragOver,
    dropTargetProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
