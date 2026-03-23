import { useRef, useState } from "react";
import { FolderInput, ArrowDownAZ, Search, ChevronRight } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { RecentCard } from "./recent-card";
import { ExplorerTree, ExplorerTreeHandle } from "./explorer/explorer-tree";
import { SemanticTags } from "./semantic-tags";
import { CreateNewDropdown } from "./create-new-dropdown";


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
  const explorerRef = useRef<ExplorerTreeHandle>(null);
  const [currentPath, setCurrentPath] = useState<string[]>(["Home"]);

  return (
    <div className="relative flex h-full w-full bg-page">
      <Sidebar />

      <main className="ml-64 flex-1 overflow-y-auto px-12 pt-12 pb-12">
        <h1 className="font-heading text-8xl font-extralight leading-[48px] text-text-primary">
          Digital Library
        </h1>

        {/* Recently Opened */}
        <section className="mt-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-heading text-2xl font-normal leading-8 text-text-primary">
              Recently Opened
            </h3>
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
              <div className="flex items-center gap-2">
                <h3
                  onClick={() => setCurrentPath(["Home"])}
                  className="font-heading text-2xl font-normal leading-8 text-text-primary cursor-pointer hover:text-text-secondary transition-colors"
                >
                  Explorer
                </h3>
                {currentPath.length > 1 && (
                  <div className="flex items-center gap-1 text-sm text-text-muted">
                    <ChevronRight className="size-3.5 shrink-0" />
                    {currentPath.slice(1).map((segment, i) => {
                      const isLast = i === currentPath.length - 2;
                      return (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <ChevronRight className="size-3 shrink-0 text-text-muted" />}
                          <button
                            onClick={() => setCurrentPath(currentPath.slice(0, i + 2))}
                            className={`transition-colors ${
                              isLast
                                ? "text-text-secondary font-medium"
                                : "text-text-muted hover:text-text-secondary cursor-pointer"
                            }`}
                          >
                            {segment}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
                  <FolderInput className="size-4" />
                </button>
                <button className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
                  <ArrowDownAZ className="size-4" />
                </button>
                <CreateNewDropdown
                  currentPath={currentPath}
                  onCreated={() => explorerRef.current?.reload()}
                />
              </div>
            </div>

            <ExplorerTree
              ref={explorerRef}
              currentPath={currentPath}
              onNavigate={setCurrentPath}
            />
          </div>

          <div className="col-span-4">
            <SemanticTags />
          </div>
        </section>
      </main>
    </div>
  );
}
