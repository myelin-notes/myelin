import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";
import { MyelinFile } from "@/lib/utils/file-system";

export function FileItem({ file, path }: { file: MyelinFile; path: string[] }) {
  const navigate = useNavigate();
  const fullName = `${file.name}.${file.type}`;

  return (
    <button
      onClick={() => navigate(`/${file.type}/${path.join("/")}/${fullName}`)}
      className="flex w-full items-center gap-3 rounded px-4 py-2 hover:bg-surface/60 transition-colors"
    >
      <FileText className="size-3 text-text-secondary shrink-0" />
      <span className="text-sm font-normal text-text-secondary">
        {file.name}
      </span>
    </button>
  );
}
