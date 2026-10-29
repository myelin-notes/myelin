# Myelin Notes website

The marketing site, built with Astro and prerendered in English, Spanish,
French, and Simplified Chinese. Copy for every locale lives in
`src/content/site/`.

- `/` is a static landing page (`src/components/static/StaticSite.astro`).
- `/try` mounts the real canvas engine from `@myelin/editor`
  (`src/canvas/CanvasEditor.tsx`). The document is saved to IndexedDB and
  restored on the next visit (`src/lib/try-canvas-storage.ts`). The editor
  bundle is only requested by this page.

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

## Downloads and analytics

Download links ship pointing at the GitHub releases page, and
`src/lib/downloads.ts` upgrades them to the latest release's installers. Every
`a[data-download]` click sends a PostHog `download_clicked` event with the
platform, and every `a[data-try]` click sends `try_clicked` (see
`src/layouts/Base.astro`). Anything recorded on the site must
match the "This website" section of `src/pages/privacy.astro`.
