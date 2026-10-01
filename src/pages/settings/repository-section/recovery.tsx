import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { Button } from '@myelin/ui/button';
import { useRepository, useRepositoryStatus } from '@/lib/sync';

const logger = new Logger('RepositoryRecovery');

export function RepositoryRecovery() {
  const repository = useRepository();
  const status = useRepositoryStatus();
  const copy = useMessages().settings.repository.recovery;
  const [recovering, setRecovering] = useState(false);

  if (status.config.kind !== 'google-drive' || !repository.recoverManifest) {
    return null;
  }

  const recover = async () => {
    if (recovering || !repository.recoverManifest) {
      return;
    }
    setRecovering(true);
    const toastId = toast.loading(copy.recovering);
    try {
      const result = await repository.recoverManifest();
      toast.success(
        result.notesRecovered === 0 && result.versionsRecovered === 0
          ? copy.empty
          : copy.succeeded(result.notesRecovered, result.versionsRecovered),
        { id: toastId },
      );
    } catch (error) {
      logger.error('Failed to recover stored notes', error);
      toast.error(copy.failed, {
        id: toastId,
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-input/40 px-5 py-4 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-sm text-text-primary">{copy.title}</p>
        <p className="mt-0.5 text-text-muted text-xs">{copy.description}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void recover()}
        disabled={recovering || status.initializing || !status.config.folderId}
        aria-busy={recovering}
        className="shrink-0"
      >
        {recovering ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RotateCcw className="size-3.5" />
        )}
        {recovering ? copy.recovering : copy.button}
      </Button>
    </div>
  );
}
