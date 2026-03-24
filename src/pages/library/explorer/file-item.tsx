import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { MyelinFile } from "@/lib/utils/file-system";

export function FileItem({ file, path }: { file: MyelinFile; path: string[] }) {
  const navigate = useNavigate();
  const fullName = `${file.name}.${file.type}`;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      "application/myelin-item",
      JSON.stringify({ segments: [...path, fullName], isDirectory: false })
    );
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <button
      draggable
      onClick={() => navigate(`/${file.type}/${path.join("/")}/${fullName}`)}
      onDragStart={handleDragStart}
      className="flex w-full items-center gap-3 rounded px-4 py-2 hover:bg-surface/60 transition-colors"
    >
      <FileText className="size-3 text-text-secondary shrink-0" />
      <span className="text-sm font-normal text-text-secondary">
        {file.name}
      </span>
    </button>
  );
}
