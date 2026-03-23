import { useRef, useState } from "react";
import { FolderItem } from "./FolderItem";
import { FileItem } from "./FileItem";
import { FileSystem, MyelinFile } from "@/ts/utils/FileSystem";
import { toast } from "sonner";
import { basename, extname, join } from "@tauri-apps/api/path";
import { BaseDirectory, stat } from "@tauri-apps/plugin-fs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface FolderAndFilesProps {
  path: string[];
  directories: string[];
  files: MyelinFile[];
  onReload: () => void;
}

export function FolderAndFiles({ path, directories, files, onReload }: FolderAndFilesProps) {
  const [selectedItem, setSelectedItem] = useState<string[] | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);

  async function handleRenameClick() {
    if (!selectedItem) return;
    const p = await join(...selectedItem);
    const isFile = (await stat(p, { baseDir: BaseDirectory.AppData })).isFile;

    if (isFile) {
      let name = await basename(p, await extname(p));
      name = name.slice(0, name.length - 1);
      setRenameName(name);
    } else {
      setRenameName(await basename(p));
    }

    setRenameDialogOpen(true);
  }

  async function handleRename() {
    if (!selectedItem || !renameName) return;
    await FileSystem.renameFileOrFolder(await join(...selectedItem), renameName);
    onReload();
    toast.success("Renamed successfully", { description: `Renamed to ${renameName}` });
    setRenameDialogOpen(false);
  }

  async function handleDelete() {
    if (!selectedItem) return;
    await FileSystem.deleteFileOrFolder(selectedItem);
    onReload();
    setDeleteDialogOpen(false);
  }

  function openCtx(event: React.MouseEvent, item: string[]) {
    setSelectedItem(item);
    // Programmatically trigger context menu at the right position
    const contextEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    triggerRef.current?.dispatchEvent(contextEvent);
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger ref={triggerRef} className="grow self-stretch p-8 flex flex-col items-start justify-start gap-8 overflow-y-auto min-h-0 h-full bg-white rounded-lg shadow-sm">
            <div className="flex flex-col items-start justify-start self-stretch gap-4">
              <h1 className="text-lg font-normal m-0">Folders</h1>
              {directories.length > 0 ? (
                <div className="self-stretch grid grid-cols-[repeat(auto-fill,minmax(300px,18%))] gap-y-5 gap-x-10">
                  {directories.map((dir) => (
                    <FolderItem
                      key={dir}
                      title={dir}
                      link={path.join("/") + `/${dir}`}
                      path={path.concat(dir)}
                      openCtx={openCtx}
                    />
                  ))}
                </div>
              ) : (
                <h2 className="text-base font-normal m-0">Create a new folder</h2>
              )}
            </div>

            <div className="flex flex-col items-start justify-start self-stretch gap-4">
              <h1 className="text-lg font-normal m-0">Files</h1>
              {files.length > 0 ? (
                <div className="self-stretch grid grid-cols-[repeat(auto-fill,minmax(300px,18%))] gap-y-5 gap-x-10">
                  {files.map((file) => (
                    <FileItem
                      key={file.name}
                      file={file}
                      link={path.join("/") + `/${file.name}.${file.type}`}
                      path={path.concat(`${file.name}.${file.type}`)}
                      openCtx={openCtx}
                    />
                  ))}
                </div>
              ) : (
                <h2 className="text-base font-normal m-0">Create a new file</h2>
              )}
            </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={handleRenameClick}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            className="text-destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleRename}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Do you want to delete this?</AlertDialogTitle>
            <AlertDialogDescription>This can not be undone!</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
