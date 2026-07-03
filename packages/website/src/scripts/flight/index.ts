import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { armRegionScenes, buildHeroScene, type FlightRegion } from './scenes';

// The canvas flight: one virtual camera flying across a large 2D canvas.
// Scroll progress scrubs a master timeline that pans/zooms a camera proxy
// between region targets; "pinned" beats are simply dwell segments where the
// camera holds while a region's scene performs. Native scroll is never
// blocked. Loaded only when <html> has .flight-active (>= lg, motion OK).

const GRID = 28; // canvas dot-grid cell, px at zoom 1 — matches .flight-dots

function readRegions(stage: HTMLElement): FlightRegion[] {
  return Array.from(stage.querySelectorAll<HTMLElement>('.flight-region')).map(
    (el) => ({
      el,
      label: el.dataset.label ?? el.id,
      tx: Number(el.dataset.tx ?? 0),
      ty: Number(el.dataset.ty ?? 0),
      zoom: Number(el.dataset.zoom ?? 1),
      travel: Number(el.dataset.travel ?? 1.7),
      dwell: Number(el.dataset.dwell ?? 1.6),
    }),
  );
}

export function initFlight(): void {
  const stage = document.querySelector<HTMLElement>('.flight-stage');
  const viewport = document.querySelector<HTMLElement>('.flight-viewport');
  const world = document.querySelector<HTMLElement>('.flight-world');
  const dots = document.querySelector<HTMLElement>('.flight-dots');
  const hud = document.querySelector<HTMLElement>('.flight-hud');
  if (!stage || !viewport || !world) {
    return;
  }
  const regions = readRegions(stage);
  if (!regions.length) {
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  // If the viewport crosses the lg breakpoint or the user turns reduced
  // motion on mid-session, reload into the other mode cleanly.
  const onModeChange = () => window.location.reload();
  window
    .matchMedia('(min-width: 1024px)')
    .addEventListener('change', onModeChange, { once: true });
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', onModeChange, { once: true });

  // Camera state. `fit` scales the whole flight down a touch on short
  // viewports so tall regions still clear the nav.
  const cam = { x: regions[0].tx, y: regions[0].ty, z: regions[0].zoom };
  const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let vw = window.innerWidth;
  let vh = window.innerHeight;
  let fit = 1;
  let hudText = '';

  const measure = () => {
    vw = window.innerWidth;
    vh = window.innerHeight;
    fit = gsap.utils.clamp(0.82, 1, vh / 950);
  };
  measure();

  const render = () => {
    parallax.x += (parallax.targetX - parallax.x) * 0.06;
    parallax.y += (parallax.targetY - parallax.y) * 0.06;
    const z = cam.z * fit;
    const tx = vw / 2 - cam.x * z + parallax.x;
    const ty = vh / 2 - cam.y * z + parallax.y;
    world.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${z})`;
    if (dots) {
      // Infinite grid trick: the dot layer never travels more than one cell —
      // translate modulo the (zoomed) cell size, oversized to cover the edges.
      const cell = GRID * z;
      const mx = ((tx % cell) + cell) % cell;
      const my = ((ty % cell) + cell) % cell;
      dots.style.transform = `translate3d(${mx - cell * 3}px, ${my - cell * 3}px, 0) scale(${z})`;
    }
    if (hud) {
      const text = `x ${Math.round(cam.x)} · y ${Math.round(cam.y)} · ${Math.round(z * 100)}%`;
      if (text !== hudText) {
        hudText = text;
        hud.textContent = text;
      }
    }
  };

  // Master timeline: pan between regions (with a zoom-out "breath" scaled to
  // the distance travelled), then dwell at each one.
  const master = gsap.timeline({ defaults: { ease: 'none' } });
  const labelPositions: Record<string, number> = {};
  let pos = 0;
  regions.forEach((region, i) => {
    if (i > 0) {
      const prev = regions[i - 1];
      const dist = Math.hypot(region.tx - prev.tx, region.ty - prev.ty);
      const t = region.travel;
      const midZoom = Math.min(
        prev.zoom,
        region.zoom,
        gsap.utils.clamp(0.72, 0.92, 1 - dist / 11000),
      );
      master.to(
        cam,
        { x: region.tx, y: region.ty, duration: t, ease: 'power2.inOut' },
        pos,
      );
      master.to(cam, { z: midZoom, duration: t * 0.5, ease: 'power2.in' }, pos);
      master.to(
        cam,
        { z: region.zoom, duration: t * 0.5, ease: 'power2.out' },
        pos + t * 0.5,
      );
      pos += t;
    }
    master.addLabel(region.label, pos);
    labelPositions[region.label] = pos;
    pos += region.dwell;
  });
  // Anchor the total duration so dwells at the end aren't trimmed.
  master.set({}, {}, pos);

  // The hero performance targets decoration only (never the h1/CTAs), so it
  // can be armed immediately and play as the very first scroll happens.
  master.add(buildHeroScene(regions[0].el), labelPositions[regions[0].label]);

  const trigger = ScrollTrigger.create({
    animation: master,
    trigger: stage,
    start: 'top top',
    end: 'bottom bottom',
    scrub: 1.1,
    invalidateOnRefresh: true,
  });

  // Region scenes rewind copy to hidden start states, so they are armed on
  // first scroll intent — a crawler that never scrolls indexes the page
  // fully assembled.
  let armed = false;
  const armEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'scroll'];
  const arm = () => {
    if (armed) {
      return;
    }
    armed = true;
    armRegionScenes(regions, master, labelPositions);
    for (const type of armEvents) {
      window.removeEventListener(type, arm);
    }
  };
  for (const type of armEvents) {
    window.addEventListener(type, arm, { passive: true });
  }
  if (window.scrollY > 0) {
    arm();
  }

  // Smooth scroll, driven by the gsap ticker (single rAF for everything).
  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
    render();
  });
  gsap.ticker.lagSmoothing(0);

  const scrollPositionFor = (label: string): number =>
    trigger.start +
    (labelPositions[label] / master.duration()) * (trigger.end - trigger.start);

  // In-page anchors map to camera beats instead of document offsets.
  document.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement).closest?.(
      'a[href^="#"]',
    ) as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }
    const region = regions.find((r) => r.el.id === anchor.hash.slice(1));
    if (!region) {
      return;
    }
    event.preventDefault();
    arm();
    lenis.scrollTo(scrollPositionFor(region.label), { duration: 1.4 });
  });

  // Keyboard reachability: focusing something in an off-camera region flies
  // the camera there. Also undo the browser's attempt to scroll the
  // overflow-hidden viewport itself.
  stage.addEventListener('focusin', (event) => {
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
    const regionEl = (event.target as HTMLElement).closest('.flight-region');
    const region = regions.find((r) => r.el === regionEl);
    if (region) {
      lenis.scrollTo(scrollPositionFor(region.label), { duration: 0.8 });
    }
  });

  // Cursor parallax on the resting camera — a few px, screen-space.
  viewport.addEventListener('pointermove', (event) => {
    parallax.targetX = (event.clientX / vw - 0.5) * -12;
    parallax.targetY = (event.clientY / vh - 0.5) * -10;
  });

  window.addEventListener('resize', measure);
  render();
}
