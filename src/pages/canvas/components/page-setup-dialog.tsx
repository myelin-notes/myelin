import { useEffect, useState } from 'react';
import {
  MAX_PAGE_MARGIN,
  type PagePreset,
} from '@myelin/editor/elements/page-frame-constants';
import type { PageFrameElement } from '@myelin/editor/elements/page-frame-element';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Switch } from '@myelin/ui';
import { Button } from '@myelin/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface PageSetupDialogProps {
  frame: PageFrameElement | null;
  onClose: () => void;
}

const PX_PER_INCH = 96;

export function PageSetupDialog({ frame, onClose }: PageSetupDialogProps) {
  const strings = useMessages().canvas.frame;
  const common = useMessages().common;
  const [preset, setPreset] = useState<PagePreset | null>(null);
  const [marginIn, setMarginIn] = useState('');
  const [showPageNumbers, setShowPageNumbers] = useState(false);

  useEffect(() => {
    if (frame) {
      setPreset(frame.pagePreset);
      setMarginIn(String(frame.pageMargin / PX_PER_INCH));
      setShowPageNumbers(frame.showPageNumbers);
    }
  }, [frame]);

  const margin = Number.parseFloat(marginIn) * PX_PER_INCH;
  const marginValid =
    Number.isFinite(margin) && margin >= 0 && margin <= MAX_PAGE_MARGIN;

  const apply = () => {
    if (!frame || !marginValid) {
      return;
    }
    frame.setPagePreset(preset);
    frame.setPageMargin(margin);
    frame.setShowPageNumbers(showPageNumbers);
    onClose();
  };

  const presets: { id: PagePreset | null; label: string }[] = [
    { id: 'letter', label: strings.letterSize },
    { id: 'a4', label: strings.a4Size },
    { id: null, label: strings.customSize },
  ];

  return (
    <Dialog
      open={frame !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="z-[110] sm:max-w-sm" overlayClassName="z-[110]">
        <DialogHeader>
          <DialogTitle>{strings.pageSetup}</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="flex flex-col gap-2">
            <span className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wider">
              {strings.pageSize}
            </span>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-1">
              {presets.map((p) => (
                <button
                  key={p.id ?? 'custom'}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => setPreset(p.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 font-medium text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    preset === p.id
                      ? 'bg-card text-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === null && (
              <span className="text-muted-foreground text-xs">
                {strings.customSizeHint}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="page-setup-margins" className="font-medium text-sm">
              {strings.pageMargins}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="page-setup-margins"
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_PAGE_MARGIN / PX_PER_INCH}
                step={0.25}
                value={marginIn}
                aria-invalid={!marginValid}
                onChange={(e) => setMarginIn(e.target.value)}
                className="w-20 text-right"
              />
              <span className="text-muted-foreground text-sm">
                {strings.inchesUnit}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor="page-setup-numbers"
              className="cursor-pointer font-medium text-sm"
            >
              {strings.pageNumbers}
            </label>
            <Switch
              id="page-setup-numbers"
              checked={showPageNumbers}
              onCheckedChange={setShowPageNumbers}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" disabled={!marginValid}>
              {common.done}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
