import { useEffect, useRef, useState } from 'react';
import { Plus, Tag, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { repository } from '@/lib/repository';
import { cn } from '@/lib/utils';

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
  const [newTag, setNewTag] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    Promise.all([repository.listTags(), repository.getNode(nodeId)])
      .then(([tags, node]) => {
        setAllTags(tags.map((entry) => entry.tag));
        setNodeTags(node ? [...node.tags] : []);
      })
      .catch(console.error);
  }, [open, nodeId]);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const toggleTag = async (tag: string) => {
    if (nodeTags.includes(tag)) {
      await repository.removeTag(nodeId, tag);
      setNodeTags((prev) => prev.filter((t) => t !== tag));
    } else {
      await repository.addTag(nodeId, tag);
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
    await repository.addTag(nodeId, trimmed);
    setNodeTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    if (!allTags.includes(trimmed)) {
      setAllTags((prev) => [...prev, trimmed]);
    }
    setNewTag('');
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
            Tags on{' '}
            <span className="font-medium text-text-primary">{nodeName}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Current tags on this node */}
        <div className="flex flex-col gap-3">
          <span className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
            Active Tags
          </span>
          <div className="flex min-h-[32px] flex-wrap gap-1.5">
            {nodeTags.length === 0 && (
              <span className="text-text-muted text-xs italic">
                No tags yet
              </span>
            )}
            {nodeTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="group/tag flex cursor-pointer items-center gap-1 rounded-lg bg-tag-active px-2.5 py-1 font-medium text-text-on-dark text-xs transition-all hover:bg-accent-dark"
              >
                #{tag}
                <X className="size-3 opacity-0 transition-opacity group-hover/tag:opacity-100" />
              </button>
            ))}
          </div>
        </div>

        {/* Available tags */}
        {unusedTags.length > 0 && (
          <div className="flex flex-col gap-3">
            <span className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
              Available
            </span>
            <div className="flex flex-wrap gap-1.5">
              {unusedTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1 font-medium text-xs transition-all',
                    'bg-surface text-text-secondary hover:bg-tag hover:text-text-tag',
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
              <span className="text-sm text-text-muted">#</span>
              <input
                ref={inputRef}
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onBlur={handleCreateTag}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateTag();
                  }
                  if (e.key === 'Escape') {
                    setNewTag('');
                    setIsAdding(false);
                  }
                }}
                placeholder="Tag name..."
                className="flex-1 border-primary border-b-2 bg-transparent pb-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex cursor-pointer items-center gap-2 font-medium text-text-muted text-xs transition-colors hover:text-text-secondary"
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
