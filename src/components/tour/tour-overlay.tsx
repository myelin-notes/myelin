import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/lib/i18n';
import { positionTourCard, type TourRect, type TourSize } from './position';
import {
  anchorSelector,
  CANVAS_TOUR_ANCHOR,
  resolveTourSteps,
  type TourStep,
} from './steps';

const CARD_WIDTH = 320;
const CUTOUT_PADDING = 4;
const CUTOUT_RADIUS = 12;
const RING_WIDTH = 3;
// The tour is started at the same moment the canvas tab opens, so its toolbar
// may still be a frame or two away. Give it a moment before deciding it isn't
// coming and touring without it.
const ANCHOR_WAIT_MS = 3000;
const ANCHOR_POLL_MS = 50;

interface Layout {
  anchor: TourRect;
  card: { left: number; top: number };
}

/**
 * Walkthrough of the real UI: a ring around the anchored element plus a card
 * describing it. Anchors are found by their `data-tour` attribute and tracked
 * every frame, so the highlight follows the element through layout changes
 * without the anchors having to report anything.
 *
 * There is deliberately no dimmed surround. WebView2 does not paint a
 * translucent full-window fill while the canvas is compositing — verified with
 * a box-shadow spread, plain divs, and a masked SVG rect, all of which vanish
 * below roughly 0.9 alpha on the canvas steps. The ring carries the emphasis
 * instead.
 */
export function TourOverlay({ onFinish }: { onFinish: () => void }) {
  const strings = useMessages();
  const cardRef = useRef<HTMLDivElement>(null);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);

  const step = steps?.[index];

  useEffect(() => {
    let timer = 0;
    const deadline = performance.now() + ANCHOR_WAIT_MS;

    const check = () => {
      const ready =
        document.querySelector(anchorSelector(CANVAS_TOUR_ANCHOR)) !== null;
      if (ready || performance.now() >= deadline) {
        setSteps(
          resolveTourSteps(
            (anchor) => document.querySelector(anchorSelector(anchor)) !== null,
          ),
        );
        return;
      }
      timer = window.setTimeout(check, ANCHOR_POLL_MS);
    };

    check();
    return () => window.clearTimeout(timer);
  }, []);

  const finish = useEffectEvent(onFinish);

  useEffect(() => {
    if (steps && !step) {
      finish();
    }
  }, [steps, step]);

  useEffect(() => {
    if (!step) {
      return;
    }

    let frame = 0;
    const track = () => {
      const element = document.querySelector(anchorSelector(step.anchor));
      if (element) {
        const rect = element.getBoundingClientRect();
        const anchor: TourRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
        const card: TourSize = {
          width: CARD_WIDTH,
          height: cardRef.current?.offsetHeight ?? 0,
        };
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const next: Layout = {
          anchor,
          card: positionTourCard(anchor, step.placement, card, viewport),
        };
        setLayout((current) => (sameLayout(current, next) ? current : next));
      }
      frame = requestAnimationFrame(track);
    };

    track();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish();
      } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        setIndex((current) => current + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setIndex((current) => Math.max(0, current - 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!(step && steps && layout)) {
    return null;
  }

  const copy = strings.tour.steps[step.id];
  const isLast = index === steps.length - 1;

  return (
    <div
      className="fade-in-0 fixed inset-0 z-[300] animate-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <rect
          className="stroke-accent-dark"
          x={layout.anchor.left - CUTOUT_PADDING}
          y={layout.anchor.top - CUTOUT_PADDING}
          width={layout.anchor.width + CUTOUT_PADDING * 2}
          height={layout.anchor.height + CUTOUT_PADDING * 2}
          rx={CUTOUT_RADIUS}
          fill="none"
          strokeWidth={RING_WIDTH}
        />
      </svg>

      <div
        ref={cardRef}
        style={{
          left: layout.card.left,
          top: layout.card.top,
          width: CARD_WIDTH,
        }}
        className="absolute rounded-xl bg-card p-5 shadow-xl ring-1 ring-border-subtle/70"
      >
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.tour.progress(index + 1, steps.length)}
        </span>
        <h2 className="mt-2 font-heading text-lg text-text-primary">
          {copy.title}
        </h2>
        <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">
          {copy.description}
        </p>

        <div className="mt-5 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onFinish}
            className="text-text-muted"
          >
            {strings.tour.skip}
          </Button>
          <div className="flex items-center gap-1">
            {index > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIndex((current) => current - 1)}
              >
                {strings.tour.back}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setIndex((current) => current + 1)}
            >
              {isLast ? strings.tour.done : strings.tour.next}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function sameLayout(a: Layout | null, b: Layout): boolean {
  return (
    a !== null &&
    a.anchor.left === b.anchor.left &&
    a.anchor.top === b.anchor.top &&
    a.anchor.width === b.anchor.width &&
    a.anchor.height === b.anchor.height &&
    a.card.left === b.card.left &&
    a.card.top === b.card.top
  );
}
