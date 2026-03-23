import { FolderInput, ArrowDownAZ, Search } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { RecentCard } from "./recent-card";
import { ExplorerTree } from "./explorer-tree";
import { SemanticTags } from "./semantic-tags";

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
              <div className="flex items-center gap-4">
                <button className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
                  <FolderInput className="size-4" />
                </button>
                <button className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
                  <ArrowDownAZ className="size-4" />
                </button>
              </div>
            </div>

            <ExplorerTree />
          </div>

          <div className="col-span-4">
            <SemanticTags />
          </div>
        </section>
      </main>
    </div>
  );
}
