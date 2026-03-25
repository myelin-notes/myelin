import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FolderPlus, FilePlus, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { FileSystem, FileType } from "@/lib/utils/file-system";
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

const itemClass = "gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary";

interface CreateNewDropdownProps {
  currentFolderId: string | null;
  onCreated?: () => void;
}

export function CreateNewDropdown({ currentFolderId, onCreated }: CreateNewDropdownProps) {
  const navigate = useNavigate();
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("Unnamed Folder");

  const createFolder = useCallback(async () => {
    await FileSystem.createFolder(folderName, currentFolderId);
    toast.success("Folder created");
    setFolderDialogOpen(false);
    onCreated?.();
  }, [folderName, currentFolderId, onCreated]);

  const createFile = useCallback(async (title: string, type: FileType) => {
    const name = await FileSystem.getUniqueFileName(title, currentFolderId);
    const id = await FileSystem.createFile(name, type, currentFolderId);
    navigate(`/${type}/${id}`);
  }, [navigate, currentFolderId]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-lg bg-accent-dark px-2.5 py-1 text-text-on-dark transition-shadow hover:shadow-md cursor-pointer outline-none">
          <Plus className="size-3" strokeWidth={2.5} />
          <span className="text-xs font-medium">New</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="min-w-[180px] rounded-lg bg-page p-1.5 shadow-lg ring-1 ring-border-subtle"
        >
          <DropdownMenuItem
            className={itemClass}
            onClick={() => {
              setFolderName("Unnamed Folder");
              setFolderDialogOpen(true);
            }}
          >
            <FolderPlus className="size-4" />
            New Folder
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-border-subtle" />
          <DropdownMenuItem
            className={itemClass}
            onClick={() => createFile("Untitled Document", "mdoc")}
          >
            <FilePlus className="size-4" />
            New Document
          </DropdownMenuItem>
          <DropdownMenuItem
            className={itemClass}
            onClick={() => createFile("Untitled Canvas", "mcanvas")}
          >
            <LayoutGrid className="size-4" />
            New Canvas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="bg-page ring-1 ring-border-subtle">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-normal text-text-primary">
              New Folder
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Folder name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
            className="rounded-lg border-border-subtle bg-surface text-text-primary placeholder:text-text-muted focus:ring-accent-dark"
          />
          <DialogFooter className="border-t-border-subtle bg-transparent">
            <Button
              variant="ghost"
              className="text-text-secondary hover:text-text-primary hover:bg-surface"
              onClick={() => setFolderDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-accent-dark text-text-on-dark hover:opacity-85"
              onClick={createFolder}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
