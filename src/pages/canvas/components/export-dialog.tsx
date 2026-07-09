import { useEffect, useState } from 'react';
import { Loader2 as LoaderIcon } from 'lucide-react';
import { toast } from 'sonner';
import type {
  ExportFormat,
  ExportTarget,
} from '@myelin/editor/export/export-controller';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { trackEvent } from '@/lib/analytics';
import { useMessages } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ExportDialogProps {
  target: ExportTarget | null;
  onClose: () => void;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
};

export function ExportDialog({ target, onClose }: ExportDialogProps) {
  const strings = useMessages();
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset to the target's defaults each time the dialog opens.
  useEffect(() => {
    if (target) {
      setFormat(target.formats[0]);
      setIncludeAnnotations(true);
      setBusy(false);
      setError(null);
    }
  }, [target]);

  const handleExport = async () => {
    if (!target) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await target.run({ format, includeAnnotations });
      if (result.cancelled) {
        setBusy(false);
        return;
      }
      if (result.warnings && result.warnings.length > 0) {
        toast.warning(strings.canvas.export.exportedWithWarnings, {
          description: result.warnings.join(' '),
        });
      } else {
        toast.success(strings.canvas.export.complete);
      }
      trackEvent('export_completed', {
        format,
        include_annotations: includeAnnotations,
        had_warnings: !!result.warnings?.length,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const showFormatPicker = (target?.formats.length ?? 0) > 1;
  const showAnnotations = format === 'pdf' && !!target?.supportsAnnotations;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        // Don't allow dismissing mid-export.
        if (!open && !busy) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={!busy}
        className="z-[110] sm:max-w-md"
        overlayClassName="z-[110]"
      >
        <DialogHeader>
          <DialogTitle>{strings.canvas.export.title}</DialogTitle>
          {target?.title && (
            <DialogDescription>{target.title}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {showFormatPicker && (
            <div className="flex flex-col gap-2">
              <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                {strings.canvas.export.format}
              </span>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1">
                {target?.formats.map((f) => (
                  <button
                    key={f}
                    type="button"
                    disabled={busy}
                    aria-pressed={format === f}
                    onClick={() => setFormat(f)}
                    className={cn(
                      'rounded-md px-3 py-1.5 font-medium text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
                      format === f
                        ? 'bg-card text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {FORMAT_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showAnnotations && (
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="export-annotations"
                className="flex cursor-pointer flex-col gap-0.5"
              >
                <span className="font-medium text-sm">
                  {strings.canvas.export.includeAnnotations}
                </span>
                <span className="text-muted-foreground text-xs">
                  {strings.canvas.export.annotationsHint}
                </span>
              </label>
              <Switch
                id="export-annotations"
                checked={includeAnnotations}
                disabled={busy}
                onCheckedChange={setIncludeAnnotations}
              />
            </div>
          )}

          {error !== null && (
            <p
              className="rounded-md bg-error-soft px-3 py-2 text-error-text text-sm"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            {strings.common.cancel}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void handleExport()}
          >
            <LoaderIcon className={cn('animate-spin', !busy && 'hidden')} />
            {busy
              ? strings.canvas.export.exporting
              : error !== null
                ? strings.canvas.export.tryAgain
                : strings.canvas.export.title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
