import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, ImageIcon, LoaderCircle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Button } from '@myelin/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trackEvent } from '@/lib/analytics';
import {
  type FileType,
  type FileVersion,
  useRepository,
  type VFSNodeId,
} from '@/lib/sync';

interface VersionHistoryDialogProps {
  open: boolean;
  fileId: VFSNodeId;
  fileName: string;
  fileType: FileType;
  onOpenChange: (open: boolean) => void;
  onBeforeRestore?: () => Promise<void>;
  onRestored?: () => Promise<void> | void;
}

function formatBytes(byteLength: number, locale: string): string {
  if (byteLength < 1024) {
    return `${new Intl.NumberFormat(locale).format(byteLength)} B`;
  }
  if (byteLength < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(byteLength / 1024)} KB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(byteLength / (1024 * 1024))} MB`;
}

function formatVersionDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function VersionHistoryDialog({
  open,
  fileId,
  fileName,
  fileType,
  onOpenChange,
  onBeforeRestore,
  onRestored,
}: VersionHistoryDialogProps) {
  const strings = useMessages();
  const locale = useLocale();
  const repository = useRepository();
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<VFSNodeId | null>(
    null,
  );
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const versionListRequestRef = useRef(0);
  const restoringRef = useRef(false);

  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ?? null;

  useEffect(() => {
    const requestId = versionListRequestRef.current + 1;
    versionListRequestRef.current = requestId;

    if (!open) {
      setLoadingVersions(false);
      return;
    }

    setLoadingVersions(true);
    setVersions([]);
    setSelectedVersionId(null);

    void repository
      .listFileVersions(fileId)
      .then((nextVersions) => {
        if (versionListRequestRef.current !== requestId) {
          return;
        }
        setVersions(nextVersions);
        setSelectedVersionId(nextVersions[0]?.id ?? null);
      })
      .catch((error) => {
        if (versionListRequestRef.current !== requestId) {
          return;
        }
        setVersions([]);
        setSelectedVersionId(null);
        toast.error(strings.versionHistory.loadFailed, {
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (versionListRequestRef.current === requestId) {
          setLoadingVersions(false);
        }
      });
  }, [fileId, open, repository, strings.versionHistory.loadFailed]);

  const restoreSelectedVersion = useCallback(async () => {
    if (!selectedVersion || restoringRef.current) {
      return;
    }

    restoringRef.current = true;
    setRestoring(true);
    try {
      await onBeforeRestore?.();
      await repository.restoreFileVersion(fileId, selectedVersion.id);
      trackEvent('version_restored', {
        file_type: fileType,
        version_age_seconds: Math.round(
          (Date.now() - selectedVersion.capturedAt) / 1000,
        ),
      });
      await onRestored?.();
      toast.success(strings.versionHistory.restored);
      onOpenChange(false);
    } catch (error) {
      toast.error(strings.versionHistory.restoreFailed, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  }, [
    fileId,
    fileType,
    onBeforeRestore,
    onOpenChange,
    onRestored,
    repository,
    selectedVersion,
    strings.versionHistory.restoreFailed,
    strings.versionHistory.restored,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-h-[min(640px,calc(100vh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-border-subtle border-b px-5 py-4">
          <DialogTitle>{strings.versionHistory.title}</DialogTitle>
          <DialogDescription className="truncate">
            {strings.versionHistory.description(fileName)}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[430px] min-h-[220px] p-3">
          {loadingVersions ? (
            <div className="flex h-[220px] items-center justify-center text-text-muted">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center px-4 text-center text-sm text-text-muted">
              {strings.versionHistory.empty}
            </div>
          ) : (
            <div className="flex max-h-[404px] flex-col gap-1 overflow-y-auto pr-1">
              {versions.map((version) => {
                const selected = version.id === selectedVersionId;
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setSelectedVersionId(version.id)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                      selected
                        ? 'bg-primary/10 text-text-primary'
                        : 'text-text-secondary hover:bg-hover-tint',
                    )}
                  >
                    <Clock3 className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {formatVersionDate(version.capturedAt, locale)}
                      </span>
                      <span className="block text-text-muted text-xs">
                        {formatBytes(version.byteLength, locale)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="px-5 pb-5">
          <Button
            type="button"
            onClick={restoreSelectedVersion}
            disabled={!selectedVersion || restoring}
          >
            {restoring ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : fileType === 'mcanvas' ? (
              <RotateCcw className="size-4" />
            ) : (
              <ImageIcon className="size-4" />
            )}
            {restoring
              ? strings.versionHistory.restoring
              : strings.versionHistory.restore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
