import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { useRepository } from '@/lib/sync';
import { normalizeTagInput } from '@/lib/sync/repo/tag-hierarchy';
import { cn } from '@/lib/utils';

const logger = new Logger('TagManageDialog');

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
  const strings = useMessages();
  const repository = useRepository();
  const [allTags, setAllTags] = useState<string[]>([]);
  const [nodeTags, setNodeTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    Promise.all([repository.getNode(nodeId), repository.getRegistryTags()])
      .then(([node, registryTags]) => {
        // Available shows every tag in the registry, including ones not
        // attached to anything yet.
        setAllTags(registryTags);
        setNodeTags(node ? [...node.tags] : []);
      })
      .catch((error) => {
        logger.error('Failed to load tag dialog data', error, { nodeId });
      });
  }, [open, nodeId, repository]);

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
      await repository.addRegistryTags([tag]);
      setNodeTags((prev) => [...prev, tag]);
      if (!allTags.includes(tag)) {
        setAllTags((prev) => [...prev, tag]);
      }
    }
    onChanged();
  };

  const handleCreateTag = async () => {
    const normalized = normalizeTagInput(newTag);
    if (!normalized) {
      setIsAdding(false);
      return;
    }
    await repository.addTag(nodeId, normalized);
    await repository.addRegistryTags([normalized]);
    setNodeTags((prev) =>
      prev.includes(normalized) ? prev : [...prev, normalized],
    );
    if (!allTags.includes(normalized)) {
      setAllTags((prev) => [...prev, normalized]);
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
          <DialogTitle className="text-xl">
            {strings.library.tagDialog.title}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-text-primary">
              {strings.library.tagDialog.description(nodeName)}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* Current tags on this node */}
        <div className="flex flex-col gap-3">
          <span className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
            {strings.library.tagDialog.activeTags}
          </span>
          <div className="flex min-h-[32px] flex-wrap gap-1.5">
            {nodeTags.length === 0 && (
              <span className="text-text-muted text-xs italic">
                {strings.library.tagDialog.noTags}
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
              {strings.library.tagDialog.available}
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
                placeholder={strings.library.tagDialog.placeholder}
                className="flex-1 border-primary border-b-2 bg-transparent pb-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex cursor-pointer items-center gap-2 font-medium text-text-muted text-xs transition-colors hover:text-text-secondary"
            >
              <Plus className="size-3.5" />
              {strings.library.tagDialog.createNew}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
