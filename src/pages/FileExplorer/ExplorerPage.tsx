import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Breadcrumb } from "./Breadcrumb";
import { FolderAndFiles } from "./FolderAndFiles";
import { FileSystem, FileType, MyelinFile } from "@/ts/utils/FileSystem";
import { BaseDirectory, create, mkdir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PlusIcon from "@/assets/icons/plus.svg?react";
import FolderPlusIcon from "@/assets/icons/folder-plus.svg?react";
import FilePlusIcon from "@/assets/icons/file-plus.svg?react";
import CanvasIcon from "@/assets/icons/canvas-icon.svg?react";

export function ExplorerPage() {
  const params = useParams();
  const path = params["*"]?.split("/").filter(Boolean) ?? ["Home"];
  const navigate = useNavigate();

  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<MyelinFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("Unnamed Folder");

  const reloadFs = useCallback(async (p?: string[]) => {
    setLoading(true);
    try {
      const [dirs, fs] = await FileSystem.loadDirectory(p ?? path);
      setDirectories(dirs);
      setFiles(fs);
    } catch (err) {
      console.error("Failed to load directory:", err);
    }
    setLoading(false);
  }, [path.join("/")]);

  useEffect(() => {
    reloadFs();
  }, [reloadFs]);

  async function createFolder() {
    await mkdir(`${await join(...path)}/${createFolderName}`, { baseDir: BaseDirectory.AppData });
    await reloadFs();
    toast.success("New folder created");
    setFolderDialogOpen(false);
  }

  async function newFile(title: string, type: FileType) {
    const p = await join(...path);
    const name = await FileSystem.getUniqueFileName(title, type, p);
    const file = await create(await join(p, name), { baseDir: BaseDirectory.AppData });
    await file.close();
    navigate(`/${type}/${path.join("/")}/${name}`);
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center w-full h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <>
      <main className="p-8 gap-4 flex flex-col items-start w-full h-full box-border min-h-0 overflow-hidden">
        <div className="flex flex-row justify-between items-center self-stretch">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <Breadcrumb path={path} />
          </div>
          <div>
            <DropdownMenu>
              <DropdownMenuTrigger className="bg-secondary shadow-sm rounded-lg p-4 transition-colors hover:bg-primary cursor-pointer border-none outline-none">
                <PlusIcon width={20} height={20} className="text-icons" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { setCreateFolderName("Unnamed Folder"); setFolderDialogOpen(true); }}>
                  <FolderPlusIcon width={16} height={16} className="mr-2" />
                  New Folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => newFile("Untitled Document", "mdoc")}>
                  <FilePlusIcon width={16} height={16} className="mr-2" />
                  New Document
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => newFile("Untitled Canvas", "mcanvas")}>
                  <CanvasIcon width={16} height={16} className="mr-2" />
                  New Canvas
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <FolderAndFiles
          directories={directories}
          files={files}
          path={path}
          onReload={() => reloadFs()}
        />
      </main>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Folder Name"
            value={createFolderName}
            onChange={(e) => setCreateFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFolderDialogOpen(false)}>Cancel</Button>
            <Button onClick={createFolder}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
