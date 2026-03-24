import { useState, useRef } from "react";
import { Folder } from "lucide-react";
import { FileSystem } from "@/lib/utils/file-system";
import { join } from "@tauri-apps/api/path";

interface FolderItemProps {
  name: string;
  currentPath: string[];
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({ name, currentPath, onNavigate, onMoved }: FolderItemProps) {
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const folderPath = [...currentPath, name];

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      "application/myelin-item",
      JSON.stringify({ segments: folderPath, isDirectory: true })
    );
    e.dataTransfer.effectAllowed = "move";
  };

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
    if (segments.join("/") === folderPath.join("/")) return;
    if (segments.slice(0, -1).join("/") === folderPath.join("/")) return;

    try {
      const fromPath = await join(...segments);
      const toDir = await join(...folderPath);
      await FileSystem.moveItem(fromPath, toDir);
      onMoved();
    } catch (err) {
      console.error("Failed to move item:", err);
    }
  };

  return (
    <button
      draggable
      onClick={onNavigate}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex w-full items-center gap-3 rounded px-4 py-3 transition-colors cursor-pointer ${
        dragOver
          ? "bg-accent/15 ring-1 ring-accent/40"
          : "hover:bg-surface/60"
      }`}
    >
      <Folder className="size-4 text-amber-400 fill-amber-400 shrink-0" />
      <span className="text-sm font-medium text-text-primary">{name}</span>
    </button>
  );
}
