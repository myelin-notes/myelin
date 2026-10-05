# Myelin Notes website

The marketing site. The landing page is not a page _about_ the app; on a
desktop browser it **is** a Myelin workspace: the real canvas engine, mounted
on an in-memory document, seeded with the marketing copy as notes, ink, shapes,
and links. Scroll drives a camera along an authored path through the notebook.

```
yarn website:dev      # dev server (from repo root)
yarn website:build    # production build
```

## Support form

`/support` posts to the Cloudflare Pages Function at
`functions/api/support.ts`. The function sends through Resend and requires one
Cloudflare Pages secret named `RESEND_API_KEY`. Verify `trymyelin.app` in Resend
so the function can send from `support@trymyelin.app`.

The Pages project root must remain the repository root so Cloudflare finds the
top-level `functions/` directory. The build output is
`packages/website/dist`.

## Phase 0 spike verdict: reuse the real engine

The mandated spike asked one question: can the app's canvas be mounted in a
plain browser and seeded with arbitrary content? **Yes, and we use it.** All
four pass criteria held:

1. **Seeding is trivial.** `DrawableCanvas.addElement((uuid) => new TextElement(...))`
   places any element; the whole notebook is authored in
   [`src/content/site.ts`](src/content/site.ts) and seeded by
   [`src/canvas/seed.ts`](src/canvas/seed.ts). No fighting the data layer.
2. **No Tauri in the browser.** The render path (`DrawableCanvas`,
   `YDocManager`, `CanvasViewport`, renderers, tools, elements) makes zero Tauri
   calls. The only touchpoints are side paths (log persistence, export dialogs,
   link opening), and they are aliased to browser shims in
   [`astro.config.mjs`](astro.config.mjs) →
   [`src/canvas/tauri-shims/`](src/canvas/tauri-shims/). `__TAURI_INTERNALS__`
   is never present and nothing throws.
3. **Payload is defensible.** The canvas island is a lazy `import()` that only
   loads on desktop pointers (see below), so phones and crawlers never download
   it. pdf.js and the CodeMirror source editors stay dynamically imported by the
   engine; KaTeX/ProseMirror ride along only because the element factory graph
   pulls them, which is acceptable for a below-the-fold desktop island.
4. **Zero app changes.** The website reuses the engine through the `@` alias
   with no edits to `src/`. Root `yarn typecheck` and `yarn test` (702 tests)
   stay green.

Because we use the real components, interactions (ink feel, selection, text
editing, shape recognition, undo) come for free and stay in sync with the app.

## Architecture

### Content is data, authored in one file

[`src/content/site.ts`](src/content/site.ts) is the **single source of
marketing copy**. It exports `regions`, each with:

- `article`: the copy as plain prose (`eyebrow`, `heading`, `body`, `bullets`).
  This is what renders as crawlable static HTML.
- `items`: canvas elements (`text`, `handwriting`, `ink` gestures, `shape`,
  `latex`, `image`, and `dom` anchors) placed in **local coordinates**.
- `frame`: the rect the camera frames for this stop of the tour.

Two renderers consume it:

- [`src/pages/index.astro`](src/pages/index.astro) renders every `article` as a
  styled notebook card (the static fallback).
- [`src/canvas/seed.ts`](src/canvas/seed.ts) turns every `item` into a real
  canvas element on an in-memory `Y.Doc`.

### Product screenshots (placeholders)

The app-window images in `public/canvas/` (`shot-note`, `shot-graph`,
`shot-library`, `shot-pdf`, `shot-search`, plus the sticky notes) are
**placeholders** built with mock UI, generated from an HTML template using the
app's real design tokens and fonts. Regenerate them with
`node scripts/make-shots.mjs` (needs Playwright locally; it does not ship), or
drop in real captures at the same paths and pixel ratios. They are shown on the canvas as
`image` items and in the static fallback cards; swap the files and both update.

### Motion

Two authored moments, both respecting `prefers-reduced-motion`:

- **Cinematic open** (`src/canvas/camera.ts`): at the top of the page the camera
  holds a wide shot of the notebook, then dives into the first region over
  ~1.3s. Scrolling cancels it and hands control to the scroll path.
- **Ink draw-on** (`src/canvas/seed.ts`): `ink` items flagged `animate: true`
  are seeded empty and drawn on point-by-point once the intro settles, then undo
  history is cleared so the flourish is not something a stray Ctrl+Z peels back.

### Editing the copy later

You never touch Yjs or seeding code. To change a headline or paragraph, edit the
region's `article` and the matching `text`/`heading` `item` in `site.ts`. To add
a handwritten margin note, add a `handwriting` item with `x`/`y`. To move a
whole region on the tour, change its entry in `REGION_MOVES` (regions are
authored in convenient local coordinates and translated onto a non-overlapping
serpentine path so no region bleeds into its neighbor's framed view). Ink
gestures (`underline`, `circle`, `arrow`, `zigzag`) are generated by
[`src/canvas/ink.ts`](src/canvas/ink.ts), so a margin scribble is one line of
data, not a hand-plotted point array.

### The camera

[`src/canvas/camera.ts`](src/canvas/camera.ts) (`ScrollCamera`) maps the page's
scroll position to a point along the region path and eases the real
`CanvasViewport` toward the framed rect, dwelling on each region and gliding
between them. The scrollbar comes from an otherwise-empty `.canvas-track` div
sized to `regions.length` viewports. Manual pan or pinch-zoom detaches the
camera; it re-engages when you scroll again. It never moves while a note is
being edited.

### Chrome from the app, not the web

[`src/canvas/CanvasExperience.tsx`](src/canvas/CanvasExperience.tsx) mounts the
canvas and the app-styled chrome in [`src/canvas/chrome/`](src/canvas/chrome/):
a title bar (file name + zoom, not a navbar), the app's real tool shelf (the
same `ITool` objects and color palette), a tour progress rail, a `Cmd/Ctrl+K`
command palette that jumps between regions and pages, and a `WorldLayer` of real
DOM (download cards, links) pinned to world coordinates so conversion elements
are clickable and tabbable.

### Graceful degradation

- **Crawlers / JS-off:** the full message is real HTML in `index.astro`'s
  static fallback (~800 words), styled as notebook cards on the app's dot grid.
  Download links are present and analytics-wired.
- **Mobile / coarse pointers:** the canvas island is gated behind
  `matchMedia('(min-width: 900px) and (pointer: fine)')`, so phones get the
  static notebook with normal scrolling and never download the engine.
- **The island flips `data-canvas="on"`** on `<html>` once live, which hides the
  static fallback and the static top bar/footer in favor of the app chrome.

### Downloads and analytics

[`src/lib/downloads.ts`](src/lib/downloads.ts) ports the original page's logic
verbatim: it resolves desktop installer URLs from the updater manifest
(`updates.trymyelin.app/stable/latest.json`, the single source of truth for the
live version) and fires the PostHog `download_clicked` event. It wires both the
static links and the canvas download cards via `[data-download-platform]`.
Because URLs come from the manifest, JS-off visitors get present-but-unresolved
links (identical to the previous implementation); this is inherent to
manifest-based resolution.

## Debugging the canvas

Build with `PUBLIC_CANVAS_DEBUG=1` to expose `window.__myelinCanvas` and
`window.__myelinCamera` for inspection. Production builds do not expose them.
