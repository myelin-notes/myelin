import type { ReactNode } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useMessages } from '@/lib/i18n';
export type ConflictResolution = 'rename' | 'replace';

export interface ImportProgress {
  current: number;
  total: number;
  fileName: string;
}

export interface ImportPreviewLine {
  icon: 'note' | 'media';
  text: string;
}

export interface ImportConflict {
  nodeId: string;
}

export interface ImportPreviewData {
  name: string;
  lines: ImportPreviewLine[];
  skippedText: string | null;
  isEmpty: boolean;
  conflict: ImportConflict | null;
}

export interface ImportSummaryData {
  rootFolderId: string;
  text: string;
  skippedText: string | null;
}

export interface ImportSource {
  title: string;
  scanningLabel: string;
  emptyLabel: string;
  scan(): Promise<ImportPreviewData>;
  run(options: {
    conflictResolution: ConflictResolution;
    onProgress: (progress: ImportProgress) => void;
  }): Promise<ImportSummaryData>;
}

const previewIcons: Record<ImportPreviewLine['icon'], ReactNode> = {
  note: <FileText className="size-3.5 shrink-0" />,
  media: <Image className="size-3.5 shrink-0" />,
};

type DialogPhase =
  | { kind: 'scanning' }
  | {
      kind: 'preview';
      data: ImportPreviewData;
      conflictResolution: ConflictResolution;
    }
  | { kind: 'importing'; progress: ImportProgress | null }
  | { kind: 'summary'; data: ImportSummaryData }
  | { kind: 'error'; message: string };

interface ImportDialogProps {
  source: ImportSource;
  onImported: (rootFolderId: string) => void;
  onClose: () => void;
}

export function ImportDialog({
  source,
  onImported,
  onClose,
}: ImportDialogProps) {
  const strings = useMessages();
  const [phase, setPhase] = useState<DialogPhase>({ kind: 'scanning' });
  const importedRootRef = useRef<string | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await sourceRef.current.scan();
        if (cancelled) {
          return;
        }
        setPhase({ kind: 'preview', data, conflictResolution: 'rename' });
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
  }, []);

  const handleClose = useCallback(() => {
    if (importedRootRef.current) {
      onImported(importedRootRef.current);
    }
    onClose();
  }, [onImported, onClose]);

  const handleImport = useCallback(async () => {
    if (phase.kind !== 'preview') {
      return;
    }

    const { conflictResolution } = phase;
    setPhase({ kind: 'importing', progress: null });

    try {
      const data = await sourceRef.current.run({
        conflictResolution,
        onProgress: (progress) => {
          setPhase((prev) =>
            prev.kind === 'importing' ? { ...prev, progress } : prev,
          );
        },
      });

      importedRootRef.current = data.rootFolderId;
      setPhase({ kind: 'summary', data });
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [phase]);

  return (
    <Dialog
      open
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
          <DialogTitle>{source.title}</DialogTitle>
        </DialogHeader>

        {phase.kind === 'scanning' && (
          <div className="flex items-center gap-3 py-6">
            <LoaderCircle className="size-5 shrink-0 animate-spin text-text-muted" />
            <span className="text-sm text-text-secondary">
              {source.scanningLabel}
            </span>
          </div>
        )}

        {phase.kind === 'preview' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-surface p-3">
              <p className="mb-2 font-medium text-sm text-text-primary">
                {phase.data.name}
              </p>
              <div className="flex flex-col gap-1.5">
                {phase.data.lines.map((line) => (
                  <div
                    key={line.icon}
                    className="flex items-center gap-2 text-sm text-text-secondary"
                  >
                    {previewIcons[line.icon]}
                    {line.text}
                  </div>
                ))}
                {phase.data.skippedText && (
                  <p className="text-text-muted text-xs">
                    {phase.data.skippedText}
                  </p>
                )}
              </div>
            </div>

            {phase.data.isEmpty && (
              <p className="text-sm text-text-muted">{source.emptyLabel}</p>
            )}

            {phase.data.conflict && (
              <div className="rounded-lg bg-warning-soft p-3">
                <div className="mb-2.5 flex items-center gap-2 font-medium text-sm text-warning">
                  <AlertTriangle className="size-4 shrink-0" />
                  {strings.library.importDialog.conflict.label}
                </div>
                <RadioGroup
                  className="gap-2 pl-6"
                  value={phase.conflictResolution}
                  onValueChange={(value) =>
                    setPhase({
                      ...phase,
                      conflictResolution: value as ConflictResolution,
                    })
                  }
                >
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
                    <RadioGroupItem value="rename" />
                    {strings.library.importDialog.conflict.rename}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
                    <RadioGroupItem value="replace" />
                    {strings.library.importDialog.conflict.replace}
                  </label>
                </RadioGroup>
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
              {phase.progress
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
              <CheckCircle2 className="size-4 shrink-0 text-text-success" />
              {strings.library.importDialog.summary.title}
            </div>
            <div className="rounded-lg bg-surface p-3">
              <p className="text-sm text-text-secondary">{phase.data.text}</p>
              {phase.data.skippedText && (
                <p className="mt-1 text-text-muted text-xs">
                  {phase.data.skippedText}
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
            <Button variant="outline" onClick={handleClose}>
              {strings.library.importDialog.buttons.cancel}
            </Button>
          )}

          {phase.kind === 'preview' && (
            <>
              <Button onClick={handleImport} disabled={phase.data.isEmpty}>
                {strings.library.importDialog.buttons.import}
              </Button>
              <Button variant="outline" onClick={handleClose}>
                {strings.library.importDialog.buttons.cancel}
              </Button>
            </>
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
