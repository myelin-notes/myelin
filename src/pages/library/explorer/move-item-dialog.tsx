import { useEffect, useState } from 'react';
import { ChevronLeft, Folder } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { Button } from '@myelin/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRepository, type VFSFolderNode } from '@/lib/sync';

interface MoveItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeIds: readonly string[];
  onChanged: () => void | Promise<void>;
}

export function MoveItemDialog({
  open,
  onOpenChange,
  nodeIds,
  onChanged,
}: MoveItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <MoveItemContent
          nodeIds={nodeIds}
          onChanged={onChanged}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function MoveItemContent({
  nodeIds,
  onChanged,
  onClose,
}: Omit<MoveItemDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void;
}) {
  const repository = useRepository();
  const strings = useMessages().library.itemMenu;
  const [path, setPath] = useState<VFSFolderNode[]>([]);
  const [folders, setFolders] = useState<VFSFolderNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parentId = path.at(-1)?.id ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    repository
      .listDirectory(parentId)
      .then(([children]) => {
        if (active) {
          setFolders(children);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(strings.loadError);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [repository, parentId, strings.loadError]);

  const move = async () => {
    setMoving(true);
    setError(null);
    try {
      for (const id of nodeIds) {
        await repository.moveNode(id, parentId);
      }
      await onChanged();
      onClose();
    } catch {
      setError(strings.moveError);
    } finally {
      setMoving(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{strings.moveTo}</DialogTitle>
      </DialogHeader>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={strings.back}
          disabled={path.length === 0 || moving}
          onClick={() => setPath(path.slice(0, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="truncate">
          {path.at(-1)?.name ?? strings.workspace}
        </span>
      </div>
      <div className="max-h-72 min-h-24 overflow-y-auto" aria-busy={loading}>
        {!loading &&
          error !== strings.loadError &&
          folders
            .filter((folder) => !nodeIds.includes(folder.id))
            .map((folder) => (
              <button
                key={folder.id}
                type="button"
                disabled={moving}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-surface"
                onClick={() => setPath([...path, folder])}
              >
                <Folder className="size-4 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button
        disabled={loading || moving || error === strings.loadError}
        onClick={() => void move()}
      >
        {strings.moveHere}
      </Button>
    </DialogContent>
  );
}
