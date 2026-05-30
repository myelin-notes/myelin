import { useEffect, useState } from 'react';
import { FileText as FileTextIcon, Loader2 as LoaderIcon } from 'lucide-react';
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
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>{target?.title}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {showFormatPicker && (
            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-muted-foreground text-xs">
                Format
              </span>
              <div className="flex gap-1.5">
                {target?.formats.map((f) => (
                  <Button
                    key={f}
                    type="button"
                    variant={format === f ? 'default' : 'outline'}
                    size="sm"
                    disabled={busy}
                    onClick={() => setFormat(f)}
                  >
                    <FileTextIcon />
                    {FORMAT_LABELS[f]}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {showAnnotations && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeAnnotations}
                disabled={busy}
                onChange={(e) => setIncludeAnnotations(e.target.checked)}
              />
              Include annotations
            </label>
          )}

          {error !== null && (
            <p className="text-destructive text-sm" role="alert">
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
