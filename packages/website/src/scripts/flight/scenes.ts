import gsap from 'gsap';

// Per-region "performance" timelines. Every scene element is authored in its
// final state in the HTML, so the linear page (mobile, no-JS, reduced motion)
// shows the finished note. These timelines rewind elements to a start state
// and play them forward under scrub — .from() tweens throughout.
//
// Regions other than the hero are armed on first scroll intent (see index.ts)
// so a crawler that never scrolls sees every heading and paragraph visible.

export interface FlightRegion {
  el: HTMLElement;
  label: string;
  tx: number;
  ty: number;
  zoom: number;
  travel: number;
  dwell: number;
}

function q(scope: HTMLElement, fx: string): Element[] {
  return Array.from(scope.querySelectorAll(`[data-fx="${fx}"]`));
}

/** Prime an SVG stroke for draw-on: hide it behind its own dash offset. */
function prepDraw(els: Element[]): void {
  for (const el of els) {
    const path = el as SVGGeometryElement;
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    path.style.strokeDashoffset = `${len}`;
  }
}

function drawOn(
  tl: gsap.core.Timeline,
  els: Element[],
  duration: number,
  position: gsap.Position,
): void {
  if (!els.length) {
    return;
  }
  prepDraw(els);
  tl.to(
    els,
    { strokeDashoffset: 0, duration, ease: 'power1.inOut', stagger: 0.18 },
    position,
  );
}

/** Rough stroke draws itself, then "snaps": crossfades into the clean shape. */
function shapeSnap(
  tl: gsap.core.Timeline,
  rough: Element[],
  clean: Element[],
  drawDuration: number,
  position: gsap.Position,
): void {
  if (!rough.length || !clean.length) {
    return;
  }
  prepDraw(rough);
  tl.set(rough, { opacity: 1 }, position)
    .to(
      rough,
      { strokeDashoffset: 0, duration: drawDuration, ease: 'power1.inOut' },
      position,
    )
    .to(rough, { opacity: 0, duration: 0.3 }, '+=0.12')
    .from(clean, { opacity: 0, duration: 0.4 }, '<0.05');
}

/** The hero performance — nested at build time; targets decoration only. */
export function buildHeroScene(region: HTMLElement): gsap.core.Timeline {
  const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
  shapeSnap(tl, q(region, 'hero-rough'), q(region, 'hero-clean'), 1.1, 0);
  tl.from(
    q(region, 'hero-frame'),
    { autoAlpha: 0, y: 22, duration: 0.6 },
    '-=0.15',
  );
  tl.from(q(region, 'outline'), { autoAlpha: 0, duration: 0.3 }, '-=0.1');
  drawOn(tl, q(region, 'hero-arrow'), 0.5, '-=0.05');
  return tl;
}

type SceneBuilder = (region: HTMLElement) => gsap.core.Timeline;

const builders: Record<string, SceneBuilder> = {
  manifesto(region) {
    const tl = gsap.timeline();
    drawOn(tl, q(region, 'mani-ink'), 0.7, 0.3);
    return tl;
  },

  workspace(region) {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.from(q(region, 'ws-card'), { autoAlpha: 0, y: 34, duration: 0.7 }, 0);
    tl.from(q(region, 'outline'), { autoAlpha: 0, duration: 0.3 }, 0.55);
    shapeSnap(tl, q(region, 'ws-rough'), q(region, 'ws-clean'), 0.8, 0.5);
    tl.from(
      q(region, 'ws-frame'),
      { autoAlpha: 0, y: 26, duration: 0.6 },
      '-=0.2',
    );
    return tl;
  },

  pdf(region) {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    const pages = q(region, 'pdf-page');
    // Pages start stacked in the middle, fan out to their resting spread
    tl.from(
      pages,
      {
        x: (i: number) => [124, 0, -124][i] ?? 0,
        y: (i: number) => [12, 0, 10][i] ?? 0,
        rotation: 0,
        duration: 0.9,
        ease: 'power2.inOut',
        stagger: 0.04,
      },
      0,
    );
    drawOn(tl, q(region, 'pdf-ink'), 0.7, 0.8);
    tl.from(
      q(region, 'pdf-audio'),
      { autoAlpha: 0, y: 26, duration: 0.5 },
      1.1,
    );
    const bars = Array.from(
      region.querySelectorAll('[data-fx="pdf-wave"] rect'),
    );
    tl.from(
      bars,
      {
        scaleY: 0.12,
        transformOrigin: '50% 50%',
        duration: 0.45,
        stagger: 0.012,
      },
      1.4,
    );
    const lines = q(region, 'pdf-line');
    lines.forEach((line, i) => {
      tl.fromTo(
        line,
        { clipPath: 'inset(0% 100% 0% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5, ease: 'none' },
        1.6 + i * 0.5,
      );
    });
    return tl;
  },

  search(region) {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.from(
      q(region, 'search-card'),
      { autoAlpha: 0, y: 30, duration: 0.6 },
      0,
    );
    tl.fromTo(
      q(region, 'search-q'),
      { clipPath: 'inset(0% 100% 0% 0%)' },
      { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.45, ease: 'none' },
      0.5,
    );
    tl.from(
      q(region, 'search-row'),
      { autoAlpha: 0, x: -14, duration: 0.5, stagger: 0.2 },
      0.9,
    );
    tl.from(
      q(region, 'search-chip'),
      {
        autoAlpha: 0,
        scale: 0.6,
        transformOrigin: '50% 50%',
        duration: 0.35,
        stagger: 0.08,
      },
      1.3,
    );
    drawOn(tl, q(region, 'search-hand'), 0.6, 1.4);
    tl.from(
      q(region, 'search-hand-chip'),
      { autoAlpha: 0, scale: 0.8, duration: 0.35 },
      2.05,
    );
    return tl;
  },

  local(region) {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.from(
      q(region, 'local-snap'),
      { autoAlpha: 0, y: 26, duration: 0.5, stagger: 0.15 },
      0,
    );
    // The note settles down onto the disk
    tl.from(
      q(region, 'local-note'),
      { autoAlpha: 0, y: -40, duration: 0.7 },
      0.4,
    );
    tl.from(
      q(region, 'local-chip'),
      { autoAlpha: 0, y: 12, duration: 0.4, stagger: 0.08 },
      0.9,
    );
    return tl;
  },

  sync(region) {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.from(
      q(region, 'sync-card'),
      { autoAlpha: 0, y: 28, duration: 0.6, stagger: 0.18 },
      0,
    );
    drawOn(tl, q(region, 'sync-path'), 0.9, 0.5);
    tl.from(
      [...q(region, 'sync-label'), ...q(region, 'sync-pulse')],
      { autoAlpha: 0, duration: 0.4 },
      1.3,
    );
    return tl;
  },
};

/**
 * Arm every non-hero region: a shared "rise" entrance for its copy plus the
 * region's scene performance, nested into the master timeline at its dwell.
 * Called on first scroll intent so pre-scroll (and crawler) state is the
 * fully-assembled page.
 */
export function armRegionScenes(
  regions: FlightRegion[],
  master: gsap.core.Timeline,
  labelPositions: Record<string, number>,
): void {
  for (const region of regions) {
    if (region.label === 'hero') {
      continue;
    }
    const tl = gsap.timeline();
    const rise = q(region.el, 'rise');
    if (rise.length) {
      tl.from(
        rise,
        {
          autoAlpha: 0,
          y: 28,
          duration: 0.9,
          stagger: 0.14,
          ease: 'power2.out',
        },
        0,
      );
    }
    const scene = builders[region.label]?.(region.el);
    if (scene) {
      tl.add(scene, rise.length ? 0.35 : 0);
    }
    // Start assembling just before the camera lands, and keep the whole
    // performance inside the dwell so it finishes before the camera leaves.
    const lead = Math.min(0.4, region.travel * 0.25);
    if (tl.duration() > region.dwell + lead) {
      tl.timeScale(tl.duration() / (region.dwell + lead));
    }
    master.add(tl, labelPositions[region.label] - lead);
  }
}
