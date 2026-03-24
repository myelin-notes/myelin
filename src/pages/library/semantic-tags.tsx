import { useState } from "react";
import { cn } from "@/lib/utils";

const tags = [
  "Philosophy",
  "Architecture",
  "Systems",
  "Design",
  "Minimalism",
  "Drafts",
];

interface InsightRow {
  label: string;
  value: string;
}

const insights: InsightRow[] = [
  { label: "Total Entries", value: "216" },
  { label: "Deep Reading Time", value: "14.2h" },
  { label: "Storage Capacity", value: "12% used" },
];

export function SemanticTags() {
  const [activeTag, setActiveTag] = useState("Systems");

  return (
    <div className="flex flex-col gap-6 rounded-xl bg-surface p-8">
      {/* Heading */}
      <h3 className="font-heading text-xl font-normal text-text-primary leading-7">
        Semantic Tags
      </h3>

      {/* Tag Cloud */}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <button
            key={tag}
            onClick={() => setActiveTag(tag)}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-medium transition-shadow cursor-pointer",
              tag === activeTag
                ? "bg-tag-active text-text-on-dark shadow-md"
                : "bg-card text-text-secondary hover:shadow-md"
            )}
          >
            #{tag}
          </button>
        ))}
      </div>

      {/* Divider + Insights */}
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-10">
        <h4 className="text-[10px] font-bold uppercase tracking-[1px] text-text-secondary">
          Studio Insights
        </h4>

        <div className="flex flex-col gap-4">
          {insights.map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-sm font-normal text-text-secondary">
                {row.label}
              </span>
              <span className="text-sm font-medium text-text-primary">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Smart Suggestion */}
      {/* <div className="flex items-center gap-4 rounded bg-accent-green p-4">
        <Lightbulb className="size-[18px] shrink-0 text-text-green" />
        <p className="text-[11px] font-medium leading-[13.75px] text-text-green">
          Try grouping &ldquo;Architecture&rdquo; and &ldquo;Minimalism&rdquo;
          into a new Smart Collection.
        </p>
      </div> */}
    </div>
  );
}
