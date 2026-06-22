import { useEffect, useState } from 'react';
import { Loader2 as LoaderIcon } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { trackEvent } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { ExportFormat, ExportTarget } from './export-controller';

interface ExportDialogProps {
  target: ExportTarget | null;
  onClose: () => void;
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
};

export function ExportDialog({ target, onClose }: ExportDialogProps) {
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
        toast.warning('Exported with warnings', {
          description: result.warnings.join(' '),
        });
      } else {
        toast.success('Export complete');
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
          <DialogTitle>Export</DialogTitle>
          {target?.title && (
            <DialogDescription>{target.title}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {showFormatPicker && (
            <div className="flex flex-col gap-2">
              <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                Format
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
                <span className="font-medium text-sm">Include annotations</span>
                <span className="text-muted-foreground text-xs">
                  Drawings and notes on the page
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
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void handleExport()}
          >
            <LoaderIcon className={cn('animate-spin', !busy && 'hidden')} />
            {busy ? 'Exporting…' : error !== null ? 'Try again' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
