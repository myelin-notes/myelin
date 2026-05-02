# Product

## Register

product

## Users

Knowledge workers across four overlapping segments:

- **Students** — capturing lectures, organizing course material, building durable study notes.
- **Project management in organizations** — small/mid teams using shared notes for project context, decisions, and status.
- **Small studios** — designers, writers, researchers, and architects who treat notes as part of a creative practice.
- **Knowledge sharing** — anyone publishing or syndicating personal/professional knowledge to a small audience.

The common thread is people who *care about their notes as artifacts*, not just throwaway capture. They expect the workspace itself to feel considered.

**Platforms.** Myelin is a native app on every platform the user owns: Mac, Windows, Linux, iOS, and Android (via Tauri 2). It is *not* a web app — there is no browser version, and marketing copy must not imply otherwise. The app is local-first, with optional sync through the user's own GitHub, Google Drive, or self-hosted backend.

**Form factors.** The same product runs on three roughly distinct surfaces:

- **Desktop** (Mac/Win/Linux) — the primary surface. Pointer + keyboard, large screens, multi-column layouts, drag-and-drop, right-click context menus, keyboard shortcuts. This is where deep work happens.
- **Tablet** (iPad, Android tablets) — secondary surface. Mixed touch + pencil + keyboard. Should feel like the desktop app at a smaller scale, with touch-sized controls and pencil-aware editing on the canvas.
- **Phone** (iOS/Android) — a companion surface. Touch-first, single-column, capture- and review-oriented rather than authoring-oriented. Long-press replaces right-click; gestures replace drag-and-drop; a drawer/sheet replaces the rail sidebar.

Treat layout chrome (sidebar, toolbars, navigation, gesture affordances) as **per-form-factor**. Treat content surfaces (cards, lists, tags, document body, design tokens) as **shared**. The brand and voice are identical across all three; the shell is not.

**Multi-device, simultaneous.** A document opened on two devices stays in lockstep — sketching on a tablet with the pencil while typing on a laptop is a first-class workflow, not a sync-after-the-fact reconciliation. Edits propagate in near-real-time through the user's chosen sync backend, and both devices remain authoritative authoring surfaces. This cross-form-factor pairing (tablet + laptop, phone + desktop) is one of the product's load-bearing differentiators against Notion (web-bottlenecked), Obsidian (sync as add-on), and GoodNotes (single-surface).

## Product Purpose

Myelin is a native knowledge management app for people who want their notes to feel like a curated workspace rather than a database. It exists because the dominant tools force a tradeoff: Notion is a polished SaaS box that owns your data; Obsidian is local-first but visually utilitarian; GoodNotes is tactile but locked to handwriting on iPad.

Success looks like a user opening Myelin and feeling the same way they feel opening a well-designed physical notebook or studio — calm, focused, ready to think — while still getting the structural power of links, search, and collaborative documents.

A core part of that experience is fluid movement between devices. A user can sketch a diagram on their tablet with a pencil while typing the surrounding paragraphs on their laptop, and both halves of the document grow together without an explicit "sync" step. The product treats every device the user owns as a different lens onto the same workspace, not a separate copy to be reconciled later.

## Brand Personality

**Three words:** Calm. Considered. Editorial.

- **Voice** — quiet authority. No marketing exclamation, no "delight"-speak, no winking copy. Sentences are short and specific.
- **Tone** — warm but not chatty. The app respects that the user is in the middle of thinking; it doesn't interrupt with mascots, tooltips, or celebratory toasts.
- **Emotional goal** — when the user opens the library or sidebar, they should feel the same way they feel walking into a clean, well-lit studio: nothing in the way, everything within reach.

## Anti-references

Three explicit things Myelin should NOT look or feel like:

- **Notion** — the boxy "SaaS database with rich text" aesthetic. Drag handles, slash menus, page-as-database, the +/⋮ icons crowding every block. Myelin is not a database wearing a document costume.
- **Evernote / OneNote** — the dated, toolbar-heavy, file-cabinet utilitarianism. Three-pane Outlook-style layouts. Notebook metaphors with skeuomorphic spines.
- **Generic AI / dev-tool aesthetic** — the Linear/Vercel/AI-startup template: dark mode + neon accent, gradient text, glassmorphism heroes, "command palette as identity". Myelin is not a developer tool.

By extension, also avoid: cluttered dashboards, hero-metric layouts, identical card grids, "modal as first thought" UX, and side-stripe colored borders.

## Design Principles

1. **Studio, not SaaS** — every surface should feel like a workspace a craftsperson chose, not a CRUD admin panel. Asymmetry, breathing room, and tonal depth over rigid 12-column grids.
2. **Tonal structure, not lines** — separation comes from surface elevation and negative space. 1px borders are a last resort, not the default tool for sectioning.
3. **Editorial seriousness** — text is treated like content in a magazine, not strings in a UI. The dual-engine type system (Inter for chrome, Newsreader for documents) is load-bearing — keep it visible.
4. **Quiet by default, expressive on demand** — the resting state is calm and low-chroma. Color, motion, and emphasis are reserved for moments that earn them (status, active selection, deep work).
5. **Respect the user's attention** — no nags, mascots, gamification, marketing in-app, or celebratory animation. The product trusts the user is mid-thought.

## Accessibility & Inclusion

- **Target:** WCAG 2.1 AA across the app.
- **Motion:** honor `prefers-reduced-motion`; all non-essential motion (hover lifts, easing, decorative transitions) must degrade to instant changes or simple opacity fades.
- **Contrast:** body text must meet 4.5:1 against its surface; large text 3:1. The "Soft Studio" tonal range must not push neutrals so close together that AA contrast is lost.
- **Keyboard:** every interactive surface (sidebar items, library cards, toolbars, wheel picker) must be reachable and operable via keyboard with a visible focus indicator. Avoid keyboard traps in floating panels.
- **Color independence:** never rely on color alone to convey state (active, error, status). Pair with weight, icon, label, or position.
- **Custom controls:** the wheel picker and other custom components must expose proper ARIA roles/labels; treat them with the same rigor as native equivalents.
