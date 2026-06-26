import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import type { VFSNode } from '@/lib/sync/repo/types';
import {
  addRegistryTags,
  getRegistryTags,
  removeRegistryTag,
} from '@/lib/sync/tag-registry';

const logger = new Logger('TagRegistryDialog');

interface TagRegistryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

interface PendingDelete {
  tag: string;
  nodes: VFSNode[];
}

export function TagRegistryDialog({
  open,
  onOpenChange,
  onChanged,
}: TagRegistryDialogProps) {
  const strings = useMessages();
  const repository = useRepository();
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // The registry is the single source of truth for which tags exist.
  useEffect(() => {
    if (open) {
      setTags(getRegistryTags());
    }
  }, [open]);

  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const handleCreateTag = () => {
    const normalized = normalizeTagInput(newTag);
    if (!normalized) {
      setIsAdding(false);
      return;
    }
    addRegistryTags([normalized]);
    setTags(getRegistryTags());
    setNewTag('');
    setIsAdding(false);
    onChanged();
  };

  // Look up the affected nodes up front so the confirmation can show how many
  // files/folders the tag will be detached from.
  const requestDelete = async (tag: string) => {
    try {
      const nodes = await repository.getNodesByAnyTag([tag]);
      setPendingDelete({ tag, nodes });
    } catch (error) {
      logger.error('Failed to look up tag usage', error, { tag });
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) {
      return;
    }
    const { tag, nodes } = pendingDelete;
    try {
      for (const node of nodes) {
        await repository.removeTag(node.id, tag);
      }
      removeRegistryTag(tag);
      setTags(getRegistryTags());
      onChanged();
    } catch (error) {
      logger.error('Failed to delete tag', error, { tag });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {strings.library.tagRegistryDialog.title}
            </DialogTitle>
            <DialogDescription>
              {strings.library.tagRegistryDialog.description}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <span className="font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
              {strings.library.tagRegistryDialog.tags}
            </span>
            <div className="flex min-h-[32px] flex-wrap gap-1.5">
              {tags.length === 0 && (
                <span className="text-text-muted text-xs italic">
                  {strings.library.tagRegistryDialog.empty}
                </span>
              )}
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => requestDelete(tag)}
                  className="group/tag flex cursor-pointer items-center gap-1 rounded-lg bg-surface px-2.5 py-1 font-medium text-text-secondary text-xs transition-all hover:bg-tag hover:text-text-tag"
                >
                  #{tag}
                  <X className="size-3 opacity-0 transition-opacity group-hover/tag:opacity-100" />
                </button>
              ))}
            </div>
          </div>

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
                  placeholder={strings.library.tagRegistryDialog.placeholder}
                  className="flex-1 border-primary border-b-2 bg-transparent pb-0.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
            ) : (
              <button
                onClick={() => setIsAdding(true)}
                className="flex cursor-pointer items-center gap-2 font-medium text-text-muted text-xs transition-colors hover:text-text-secondary"
              >
                <Plus className="size-3.5" />
                {strings.library.tagRegistryDialog.createNew}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {strings.library.tagRegistryDialog.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete &&
                strings.library.tagRegistryDialog.confirmDescription(
                  pendingDelete.tag,
                  pendingDelete.nodes.length,
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{strings.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmDelete}
            >
              {strings.library.tagRegistryDialog.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
