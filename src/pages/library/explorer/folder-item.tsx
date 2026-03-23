import { Folder } from "lucide-react";

interface FolderItemProps {
  name: string;
  onNavigate: () => void;
}

export function FolderItem({ name, onNavigate }: FolderItemProps) {
  return (
    <button
      onClick={onNavigate}
      className="flex w-full items-center gap-3 rounded px-4 py-3 transition-colors hover:bg-surface/60 cursor-pointer"
    >
      <Folder className="size-4 text-amber-400 fill-amber-400 shrink-0" />
      <span className="text-sm font-medium text-text-primary">{name}</span>
    </button>
  );
}
