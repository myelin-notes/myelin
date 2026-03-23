import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderInput,
  ArrowDownAZ,
  Search,
  Plus,
  FolderPlus,
  FilePlus,
  LayoutGrid,
} from "lucide-react";
import { mkdir, create } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { RecentCard } from "./recent-card";
import { ExplorerTree, ExplorerTreeHandle } from "./explorer-tree";
import { SemanticTags } from "./semantic-tags";
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

const recentItems = [
  {
    category: "Draft",
    time: "2h ago",
    title: "The Architecture of Silence",
    excerpt:
      "Exploring the spatial dynamics of monastic retreats in the modern\u2026",
    tags: ["Architecture"],
    featured: true,
  },
  {
    category: "Research",
    time: "Yesterday",
    title: "Phenomenology of Tools",
    excerpt:
      "How physical interfaces dictate the cognitive flow of digital creators.",
    tags: ["Philosophy", "Systems"],
  },
  {
    category: "Note",
    time: "3 days ago",
    title: "Brutalist Typography",
    excerpt:
      "Collecting specimens of high-contrast sans-serifs in late 70s\u2026",
    tags: ["Design"],
  },
];

export function LibraryPage() {
  const navigate = useNavigate();
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("Unnamed Folder");

  async function createFolder() {
    const path = await join("Home", folderName);
    await mkdir(path, { baseDir: BaseDirectory.AppData });
    toast.success("Folder created");
    setFolderDialogOpen(false);
    explorerRef.current?.reload();
  }

  async function createFile(title: string, type: FileType) {
    const name = await FileSystem.getUniqueFileName(title, type, "Home");
    const file = await create(await join("Home", name), { baseDir: BaseDirectory.AppData });
    await file.close();
    navigate(`/${type}/Home/${name}`);
  }

  return (
    <div className="relative flex h-full w-full bg-page">
      <Sidebar />

      <main className="ml-64 flex-1 overflow-y-auto px-12 pt-12 pb-12">
        <h1 className="font-heading text-5xl font-extralight leading-[48px] text-text-primary">
          Digital Library
        </h1>

        {/* Recently Opened */}
        <section className="mt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-heading text-2xl font-normal leading-8 text-text-primary">
              Recently Opened
            </h3>
            <button className="text-xs uppercase tracking-[1.2px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
              View Timeline
            </button>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {recentItems.map((item) => (
              <RecentCard key={item.title} {...item} />
            ))}
          </div>
        </section>

        {/* Explorer + Tags */}
        <section className="mt-12 grid grid-cols-12 gap-12">
          <div className="col-span-8 flex flex-col gap-8">
            <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-1.5">
              <Search className="size-3.5 text-text-muted shrink-0" />
              <input
                type="text"
                placeholder="Search studio..."
                className="w-full bg-transparent py-2 px-3 text-sm font-medium text-text-primary placeholder:text-text-muted outline-none"
              />
            </div>

            <div className="flex items-center justify-between">
              <h3 className="font-heading text-2xl font-normal leading-8 text-text-primary">
                Explorer
              </h3>
              <div className="flex items-center gap-3">
                <button className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
                  <FolderInput className="size-4" />
                </button>
                <button className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
                  <ArrowDownAZ className="size-4" />
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-sm bg-accent-dark px-2.5 py-1 text-text-on-dark transition-opacity hover:opacity-85 cursor-pointer outline-none">
                    <Plus className="size-3" strokeWidth={2.5} />
                    <span className="text-xs font-medium">New</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={8}
                    className="min-w-[180px] rounded-lg bg-page p-1.5 shadow-lg ring-1 ring-border-subtle"
                  >
                    <DropdownMenuItem
                      className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
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
                      className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
                      onClick={() => createFile("Untitled Document", "mdoc")}
                    >
                      <FilePlus className="size-4" />
                      New Document
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
                      onClick={() => createFile("Untitled Canvas", "mcanvas")}
                    >
                      <LayoutGrid className="size-4" />
                      New Canvas
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <ExplorerTree ref={explorerRef} />
          </div>

          <div className="col-span-4">
            <SemanticTags />
          </div>
        </section>
      </main>

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
    </div>
  );
}
