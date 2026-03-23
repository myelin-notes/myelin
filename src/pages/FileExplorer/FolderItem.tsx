import { Link } from "react-router-dom";
import FolderIcon from "@/assets/icons/folder.svg?react";

interface FolderItemProps {
  title: string;
  link: string;
  path: string[];
  openCtx: (event: React.MouseEvent, item: string[]) => void;
}

export function FolderItem({ title, link, path, openCtx }: FolderItemProps) {
  return (
    <Link
      to={`/file/${link}`}
      className="flex flex-row justify-start items-center gap-4 bg-secondary rounded-lg p-4 shadow-sm transition-colors hover:bg-primary cursor-pointer"
      onContextMenu={(e) => {
        e.preventDefault();
        openCtx(e, path);
      }}
    >
      <FolderIcon className="w-6 text-accent" />
      <span>{title}</span>
    </Link>
  );
}
