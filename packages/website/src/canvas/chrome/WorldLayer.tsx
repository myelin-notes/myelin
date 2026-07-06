import { useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';
import { wireDownloadLinks } from '../../lib/downloads';
import type { DomAnchor } from '../seed';

/**
 * Real DOM (links, buttons, hints) pinned to world coordinates on the canvas.
 * Canvas pixels can't be clicked or tabbed to, so anything conversion-critical
 * lives here and rides the camera via a per-frame transform.
 */
export function WorldLayer({
  dc,
  anchors,
}: {
  dc: DrawableCanvas;
  anchors: DomAnchor[];
}) {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      const viewport = dc.viewport;
      anchors.forEach((anchor, index) => {
        const el = itemRefs.current[index];
        if (!el) {
          return;
        }
        const screen = viewport.worldToScreen({ x: anchor.x, y: anchor.y });
        el.style.transform = `translate(${screen.x}px, ${screen.y}px) scale(${viewport.zoom})`;
      });
    };
    sync();
    const unsubscribe = dc.viewport.onViewChange(sync);
    window.addEventListener('resize', sync);
    return () => {
      unsubscribe();
      window.removeEventListener('resize', sync);
    };
  }, [dc, anchors]);

  useEffect(() => {
    if (rootRef.current) {
      wireDownloadLinks(rootRef.current);
    }
  }, [anchors]);

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-[11] overflow-hidden"
    >
      {anchors.map((anchor, index) => (
        <div
          key={`${anchor.slot}-${index}`}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: anchor.width }}
        >
          {anchor.slot === 'download-card' && <DownloadCard />}
          {anchor.slot === 'schema-link' && (
            <a
              href="/workspace-schema"
              className="pointer-events-auto text-lg text-(--text-link) underline underline-offset-4"
            >
              read the file format
            </a>
          )}
          {anchor.slot === 'scroll-hint' && <ScrollHint />}
        </div>
      ))}
    </div>
  );
}

function DownloadCard() {
  return (
    <div className="pointer-events-auto rounded-xl bg-card p-5 shadow-elevated ring-1 ring-border-subtle">
      <p className="text-sm font-medium text-text-primary">
        Download Myelin Notes
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['macOS', 'Windows', 'Linux'] as const).map((platform) => (
          <a
            key={platform}
            href="#download"
            data-download-platform={platform}
            className="rounded-md bg-accent-dark px-3.5 py-2 text-sm font-medium text-text-on-dark transition-opacity hover:opacity-90"
          >
            {platform}
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-muted">
        Free during early access. iPad and Android are on the way.
      </p>
    </div>
  );
}

function ScrollHint() {
  return (
    <div className="flex animate-bounce flex-col items-center gap-1 text-text-muted">
      <span className="font-hand text-2xl">scroll to walk the notebook</span>
      <ChevronDown className="size-5" />
    </div>
  );
}
