import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Image,
  LoaderCircle,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n';
import type { Repository, VFSFolderNode } from '@/lib/sync';
import {
  getPathName,
  type ImportProgress,
  importObsidianVault,
  type ObsidianVaultImportResult,
  type ScannedVault,
  scanVault,
} from './import-obsidian-vault';

type ConflictResolution = 'rename' | 'replace';

type DialogPhase =
  | { kind: 'scanning' }
  | {
      kind: 'preview';
      scanned: ScannedVault;
      vaultName: string;
      conflict: VFSFolderNode | null;
      conflictResolution: ConflictResolution;
    }
  | {
      kind: 'importing';
      progress: ImportProgress | null;
      cancelling: boolean;
    }
  | {
      kind: 'summary';
      result: ObsidianVaultImportResult;
      cancelled: boolean;
    }
  | { kind: 'error'; message: string };

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vaultPath: string;
  parentId: string | null;
  repository: Repository;
  onImported: (rootFolderId: string) => void;
}

export function ImportDialog({
  open,
  onOpenChange,
  vaultPath,
  parentId,
  repository,
  onImported,
}: ImportDialogProps) {
  const strings = useMessages();
  const [phase, setPhase] = useState<DialogPhase>({ kind: 'scanning' });
  const abortRef = useRef<AbortController | null>(null);
  const importedRootRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPhase({ kind: 'scanning' });
    importedRootRef.current = null;

    let cancelled = false;
    (async () => {
      try {
        const scanned = await scanVault(vaultPath);
        if (cancelled) {
          return;
        }

        const vaultName = getPathName(vaultPath);
        const [folders] = await repository.listDirectory(parentId);
        const conflict =
          folders.find(
            (f) => f.name.toLowerCase() === vaultName.toLowerCase(),
          ) ?? null;

        if (cancelled) {
          return;
        }
        setPhase({
          kind: 'preview',
          scanned,
          vaultName,
          conflict,
          conflictResolution: 'rename',
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPhase({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, vaultPath, parentId, repository]);

  const handleClose = useCallback(() => {
    if (importedRootRef.current) {
      onImported(importedRootRef.current);
    }
    onOpenChange(false);
  }, [onImported, onOpenChange]);

  const handleImport = useCallback(async () => {
    if (phase.kind !== 'preview') {
      return;
    }

    const { scanned, vaultName, conflict, conflictResolution } = phase;
    setPhase({ kind: 'importing', progress: null, cancelling: false });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (conflict && conflictResolution === 'replace') {
        await repository.deleteNode(conflict.id);
      }

      const result = await importObsidianVault({
        repository,
        parentId,
        vaultPath,
        vaultName:
          conflict && conflictResolution === 'rename' ? undefined : vaultName,
        scanned,
        signal: controller.signal,
        onProgress: (progress) => {
          setPhase((prev) =>
            prev.kind === 'importing' ? { ...prev, progress } : prev,
          );
        },
      });

      importedRootRef.current = result.rootFolderId;
      setPhase({
        kind: 'summary',
        result,
        cancelled: controller.signal.aborted,
      });
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      abortRef.current = null;
    }
  }, [phase, repository, parentId, vaultPath]);

  const handleCancel = useCallback(() => {
    if (phase.kind === 'importing') {
      abortRef.current?.abort();
      setPhase((prev) =>
        prev.kind === 'importing' ? { ...prev, cancelling: true } : prev,
      );
    } else {
      onOpenChange(false);
    }
  }, [phase.kind, onOpenChange]);

  const noteCount =
    phase.kind === 'preview'
      ? phase.scanned.files.filter((f) => f.kind === 'markdown').length
      : 0;
  const mediaCount =
    phase.kind === 'preview'
      ? phase.scanned.files.filter((f) => f.kind !== 'markdown').length
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={phase.kind !== 'importing'}
        className="sm:max-w-[420px]"
      >
        <DialogHeader>
          <DialogTitle>{strings.library.importDialog.title}</DialogTitle>
        </DialogHeader>

        {phase.kind === 'scanning' && (
          <div className="flex items-center gap-3 py-6">
            <LoaderCircle className="size-5 shrink-0 animate-spin text-text-muted" />
            <span className="text-sm text-text-secondary">
              {strings.library.importDialog.scanning}
            </span>
          </div>
        )}

        {phase.kind === 'preview' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-surface p-3">
              <p className="mb-2 font-medium text-sm text-text-primary">
                {phase.vaultName}
              </p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <FileText className="size-3.5 shrink-0" />
                  {strings.library.importDialog.notes(noteCount)}
                </div>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Image className="size-3.5 shrink-0" />
                  {strings.library.importDialog.media(mediaCount)}
                </div>
                {phase.scanned.skippedFiles > 0 && (
                  <p className="text-text-muted text-xs">
                    {strings.library.importDialog.skippedFiles(
                      phase.scanned.skippedFiles,
                    )}
                  </p>
                )}
              </div>
            </div>

            {phase.scanned.files.length === 0 && (
              <p className="text-sm text-text-muted">
                {strings.library.importDialog.noFiles}
              </p>
            )}

            {phase.conflict && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-50/50 p-3 dark:bg-amber-950/20">
                <div className="mb-2 flex items-center gap-2 font-medium text-amber-700 text-sm dark:text-amber-400">
                  <AlertTriangle className="size-4 shrink-0" />
                  {strings.library.importDialog.conflict.label}
                </div>
                <div className="flex flex-col gap-1.5 pl-6">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="radio"
                      name="conflict"
                      checked={phase.conflictResolution === 'rename'}
                      onChange={() =>
                        setPhase({ ...phase, conflictResolution: 'rename' })
                      }
                      className="accent-accent-dark"
                    />
                    {strings.library.importDialog.conflict.rename}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="radio"
                      name="conflict"
                      checked={phase.conflictResolution === 'replace'}
                      onChange={() =>
                        setPhase({ ...phase, conflictResolution: 'replace' })
                      }
                      className="accent-accent-dark"
                    />
                    {strings.library.importDialog.conflict.replace}
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {phase.kind === 'importing' && (
          <div className="flex flex-col gap-3 py-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent-dark transition-[width] duration-300 ease-out"
                style={{
                  width: phase.progress
                    ? `${(phase.progress.current / phase.progress.total) * 100}%`
                    : '0%',
                }}
              />
            </div>
            <p className="text-sm text-text-secondary">
              {phase.cancelling
                ? strings.library.importDialog.progress.cancelling
                : phase.progress
                  ? strings.library.importDialog.progress.importing(
                      phase.progress.current,
                      phase.progress.total,
                    )
                  : strings.library.importDialog.progress.importing(0, 0)}
            </p>
            {phase.progress && (
              <p className="truncate text-text-muted text-xs">
                {phase.progress.fileName}
              </p>
            )}
          </div>
        )}

        {phase.kind === 'summary' && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2 font-medium text-sm text-text-primary">
              <CheckCircle2 className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              {phase.cancelled
                ? strings.library.importDialog.summary.cancelled
                : strings.library.importDialog.summary.title}
            </div>
            <div className="rounded-lg bg-surface p-3">
              <p className="text-sm text-text-secondary">
                {strings.library.importDialog.summary.imported(
                  phase.result.notesImported,
                  phase.result.mediaImported,
                )}
              </p>
              {phase.result.skippedFiles > 0 && (
                <p className="mt-1 text-text-muted text-xs">
                  {strings.library.importDialog.summary.skipped(
                    phase.result.skippedFiles,
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex items-start gap-2 py-2">
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-text-secondary">{phase.message}</p>
          </div>
        )}

        <DialogFooter>
          {phase.kind === 'scanning' && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {strings.library.importDialog.buttons.cancel}
            </Button>
          )}

          {phase.kind === 'preview' && (
            <>
              <Button
                onClick={handleImport}
                disabled={phase.scanned.files.length === 0}
              >
                {strings.library.importDialog.buttons.import}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {strings.library.importDialog.buttons.cancel}
              </Button>
            </>
          )}

          {phase.kind === 'importing' && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={phase.cancelling}
            >
              {strings.library.importDialog.buttons.cancel}
            </Button>
          )}

          {(phase.kind === 'summary' || phase.kind === 'error') && (
            <Button onClick={handleClose}>
              {strings.library.importDialog.buttons.done}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
