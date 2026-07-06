import { Command, FileText } from 'lucide-react';

interface TitleBarProps {
  regionLabel: string;
  zoomLevel: number;
  onOpenPalette: () => void;
  onDownload: () => void;
}

/** Site navigation styled as the app's window chrome, not a marketing navbar. */
export function TitleBar({
  regionLabel,
  zoomLevel,
  onOpenPalette,
  onDownload,
}: TitleBarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-3 border-b border-border-divider bg-toolbar px-4 backdrop-blur-md">
      <a href="/" className="flex items-baseline gap-2">
        <span className="font-heading text-lg text-text-primary">
          Myelin Notes
        </span>
        <span className="rounded-full bg-tag px-2 py-0.5 text-[11px] font-medium text-text-tag">
          early access
        </span>
      </a>

      <div className="pointer-events-none absolute inset-x-0 mx-auto hidden w-fit items-center gap-2 rounded-md bg-card px-3 py-1 text-xs text-text-secondary ring-1 ring-border-subtle md:flex">
        <FileText className="size-3.5 text-text-muted" />
        <span>welcome-tour.mcanvas</span>
        <span className="text-text-muted">·</span>
        <span className="text-text-muted">{regionLabel}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden w-12 text-right text-xs tabular-nums text-text-muted lg:inline">
          {zoomLevel}%
        </span>
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex cursor-pointer items-center gap-1.5 rounded-md bg-key px-2 py-1 text-xs text-text-secondary ring-1 ring-border-key transition-colors hover:bg-hover-tint"
          aria-label="Open command palette"
        >
          <Command className="size-3" />
          <span>K</span>
        </button>
        <button
          type="button"
          onClick={onDownload}
          data-download-jump
          className="cursor-pointer rounded-md bg-accent-dark px-3 py-1.5 text-xs font-medium text-text-on-dark transition-opacity hover:opacity-90"
        >
          Download
        </button>
      </div>
    </header>
  );
}
