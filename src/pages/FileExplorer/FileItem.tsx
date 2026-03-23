import { Link } from "react-router-dom";
import { MyelinFile } from "@/ts/utils/FileSystem";
import { LayoutGrid as CanvasIcon, FileText as DocumentIcon } from "lucide-react";

interface FileItemProps {
  file: MyelinFile;
  link: string;
  path: string[];
  openCtx: (event: React.MouseEvent, item: string[]) => void;
}

export function FileItem({ file, link, path, openCtx }: FileItemProps) {
  return (
    <Link
      to={`/${file.type}/${link}`}
      className="flex flex-col justify-center items-center p-0 bg-secondary rounded-lg shadow-sm transition-colors hover:bg-primary cursor-pointer overflow-hidden"
      onContextMenu={(e) => {
        e.preventDefault();
        openCtx(e, path);
      }}
    >
      <div className="flex flex-row justify-start items-center gap-4 w-full box-border p-4">
        {file.type === "mcanvas" ? (
          <CanvasIcon className="h-6 text-icons -mr-2" />
        ) : (
          <DocumentIcon className="h-6 text-icons pr-2" />
        )}
        <span>{file.name}</span>
      </div>
      <img
        src={file.preview}
        className="w-full h-[225px] object-cover bg-white rounded-b-lg"
        alt={file.name}
      />
    </Link>
  );
}
