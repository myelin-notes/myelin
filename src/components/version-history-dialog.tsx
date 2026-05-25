import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock3,
  FileText,
  ImageIcon,
  LoaderCircle,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocale, useMessages } from '@/lib/i18n';
import {
  type FileType,
  type FileVersion,
  getMimeTypeForFileType,
  isImageFileType,
  isVideoFileType,
  useRepository,
  type VFSNodeId,
} from '@/lib/sync';
import { cn } from '@/lib/utils';
import { extractCanvasPreviewText } from '@/pages/canvas/page-frame/preview-text';

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

function createObjectUrl(bytes: Uint8Array, fileType: FileType): string {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return URL.createObjectURL(
    new Blob([buffer], { type: getMimeTypeForFileType(fileType) }),
  );
}

function VersionPreview({
  bytes,
  fileType,
  objectUrl,
  previewText,
}: {
  bytes: Uint8Array | null;
  fileType: FileType;
  objectUrl: string | null;
  previewText: string | null;
}) {
  const strings = useMessages();
  const locale = useLocale();

  if (!bytes) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        {strings.versionHistory.selectVersion}
      </div>
    );
  }

  if (fileType === 'mcanvas') {
    return (
      <div className="h-full overflow-auto rounded-lg bg-surface/70 p-4 text-sm text-text-secondary leading-6">
        {previewText || strings.versionHistory.emptyCanvas}
      </div>
    );
  }

  if (objectUrl && isImageFileType(fileType)) {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden rounded-lg bg-surface">
        <img
          src={objectUrl}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }

  if (objectUrl && isVideoFileType(fileType)) {
    return (
      <div className="flex h-full items-center justify-center overflow-hidden rounded-lg bg-surface">
        <video src={objectUrl} controls className="max-h-full max-w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg bg-surface text-sm text-text-muted">
      <FileText className="size-8" />
      <span>{strings.versionHistory.previewUnavailable}</span>
      <span className="text-xs">{formatBytes(bytes.byteLength, locale)}</span>
    </div>
  );
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
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const versionListRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
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
    setPreviewBytes(null);
    setPreviewText(null);

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

  useEffect(() => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setPreviewBytes(null);
    setPreviewText(null);

    if (!open || !selectedVersionId) {
      setLoadingPreview(false);
      return;
    }

    setLoadingPreview(true);

    void repository
      .readFileBytes(selectedVersionId)
      .then((bytes) => {
        const nextPreviewText =
          bytes && fileType === 'mcanvas'
            ? extractCanvasPreviewText(bytes)
            : null;
        if (previewRequestRef.current === requestId) {
          setPreviewBytes(bytes);
          setPreviewText(nextPreviewText);
        }
      })
      .catch((error) => {
        if (previewRequestRef.current !== requestId) {
          return;
        }
        toast.error(strings.versionHistory.previewFailed, {
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (previewRequestRef.current === requestId) {
          setLoadingPreview(false);
        }
      });
  }, [
    fileType,
    open,
    repository,
    selectedVersionId,
    strings.versionHistory.previewFailed,
  ]);

  const objectUrl = useMemo(() => {
    if (!previewBytes || fileType === 'mcanvas') {
      return null;
    }
    return createObjectUrl(previewBytes, fileType);
  }, [fileType, previewBytes]);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const restoreSelectedVersion = useCallback(async () => {
    if (!selectedVersion || restoringRef.current) {
      return;
    }

    restoringRef.current = true;
    setRestoring(true);
    try {
      await onBeforeRestore?.();
      await repository.restoreFileVersion(fileId, selectedVersion.id);
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
      <DialogContent className="grid max-h-[min(720px,calc(100vh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-border-subtle border-b px-5 py-4">
          <DialogTitle>{strings.versionHistory.title}</DialogTitle>
          <DialogDescription className="truncate">
            {strings.versionHistory.description(fileName)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 md:grid-cols-[240px_1fr]">
          <div className="min-h-[180px] border-border-subtle border-b p-3 md:h-[430px] md:border-r md:border-b-0">
            {loadingVersions ? (
              <div className="flex h-full items-center justify-center text-text-muted">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : versions.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-text-muted">
                {strings.versionHistory.empty}
              </div>
            ) : (
              <div className="flex h-full flex-col gap-1 overflow-y-auto pr-1">
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

          <div className="relative h-[360px] min-h-0 p-4 md:h-[430px]">
            {loadingPreview && (
              <div className="absolute inset-4 z-10 flex items-center justify-center rounded-lg bg-background/60 text-text-muted backdrop-blur-sm">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            )}
            <VersionPreview
              bytes={previewBytes}
              fileType={fileType}
              objectUrl={objectUrl}
              previewText={previewText}
            />
          </div>
        </div>

        <DialogFooter className="m-0">
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
