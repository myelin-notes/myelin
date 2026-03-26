import { useState, useEffect, useRef } from "react";
import { Plus, X, Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileSystem, VFSManifest } from "@/lib/utils/file-system";
import { cn } from "@/lib/utils";

interface TagManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  nodeName: string;
  onChanged: () => void;
}

export function TagManageDialog({
  open,
  onOpenChange,
  nodeId,
  nodeName,
  onChanged,
}: TagManageDialogProps) {
  const [allTags, setAllTags] = useState<string[]>([]);
  const [nodeTags, setNodeTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    FileSystem.getManifest().then((manifest: VFSManifest) => {
      const all = FileSystem.getAllTags(manifest).map((t) => t.tag);
      const node = manifest.nodes[nodeId];
      setAllTags(all);
      setNodeTags(node ? [...node.tags] : []);
    });
  }, [open, nodeId]);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  const toggleTag = async (tag: string) => {
    if (nodeTags.includes(tag)) {
      await FileSystem.removeTag(nodeId, tag);
      setNodeTags((prev) => prev.filter((t) => t !== tag));
    } else {
      await FileSystem.addTag(nodeId, tag);
      setNodeTags((prev) => [...prev, tag]);
      if (!allTags.includes(tag)) {
        setAllTags((prev) => [...prev, tag]);
      }
    }
    onChanged();
  };

  const handleCreateTag = async () => {
    const trimmed = newTag.trim();
    if (!trimmed) {
      setIsAdding(false);
      return;
    }
    await FileSystem.addTag(nodeId, trimmed);
    setNodeTags((prev) =>
      prev.includes(trimmed) ? prev : [...prev, trimmed]
    );
    if (!allTags.includes(trimmed)) {
      setAllTags((prev) => [...prev, trimmed]);
    }
    setNewTag("");
    setIsAdding(false);
    onChanged();
  };

  const unusedTags = allTags.filter((t) => !nodeTags.includes(t));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Tag className="size-5 text-text-muted" />
            Manage Tags
          </DialogTitle>
          <DialogDescription>
            Tags on <span className="font-medium text-text-primary">{nodeName}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Current tags on this node */}
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[1px] text-text-muted">
            Active Tags
          </span>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {nodeTags.length === 0 && (
              <span className="text-xs text-text-muted italic">No tags yet</span>
            )}
            {nodeTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="group/tag flex items-center gap-1 rounded-lg bg-tag-active px-2.5 py-1 text-xs font-medium text-text-on-dark transition-all hover:bg-accent-dark cursor-pointer"
              >
                #{tag}
                <X className="size-3 opacity-0 group-hover/tag:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>

        {/* Available tags */}
        {unusedTags.length > 0 && (
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[1px] text-text-muted">
              Available
            </span>
            <div className="flex flex-wrap gap-1.5">
              {unusedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                    "bg-surface text-text-secondary hover:bg-tag hover:text-text-tag"
                  )}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Create new tag */}
        <div className="rounded-lg bg-page p-3">
          {isAdding ? (
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-sm">#</span>
              <input
                ref={inputRef}
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onBlur={handleCreateTag}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateTag();
                  if (e.key === "Escape") {
                    setNewTag("");
                    setIsAdding(false);
                  }
                }}
                placeholder="Tag name..."
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none border-b-2 border-primary pb-0.5"
              />
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" />
              Create new tag
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
