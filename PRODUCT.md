# Myelin — Product Overview

Internal product spec. Describes what Myelin is, who it's for, and what actually ships today. Feature claims here are limited to what exists and works in the codebase; forward-looking items are called out explicitly.

## What Myelin Is

Myelin is a native, local-first knowledge app built around a **hybrid canvas**: handwriting, typed text, PDFs, images, math, audio, and runnable code all live together as one note, kept on your own machine. It exists because the dominant tools force a tradeoff — Notion is a polished SaaS box that owns your data, Obsidian is local-first but text-only, GoodNotes is tactile but locked to ink on an iPad. Myelin sits in the gap none of them occupy: ink *and* type *and* documents *and* code, on one surface, on your disk.

The product treats a note as an artifact worth keeping, not throwaway capture. The resting experience should feel like a well-lit studio — calm, considered, nothing in the way — while still giving you links, search, and structured documents.

## Target Audience

Knowledge workers who care about their notes as durable artifacts, across four overlapping segments:

- **Students** — capturing lectures (handwriting + type + audio), organizing course material, building study notes that last.
- **Project work inside organizations** — small/mid teams keeping project context, decisions, and status as shared notes.
- **Small studios** — designers, writers, researchers, architects who treat notes as part of a creative practice.
- **Knowledge sharing** — people who organize and pass on personal or professional knowledge to a small audience.

The common thread: they expect the workspace itself to feel considered, and they want to own what they make.

## Positioning

**Wedge:** the local-first hybrid canvas where handwriting, type, PDFs, images, and code live as one note — on your machine and in a format you can always get out of.

Against the field:

- **Notion** — web-bottlenecked, database-shaped, owns your data. Myelin is local-first and not a database wearing a document costume.
- **Obsidian** — local-first but text-only; no ink, no canvas. Myelin adds the hybrid canvas on top of the same ownership story.
- **GoodNotes** — great ink, but single-surface and locked to iPad/iCloud. Myelin is cross-platform and not ink-only.

## Features (Shipped Today)

### Hybrid canvas

A spatial canvas that holds mixed content as first-class elements:

- **Handwriting / ink** — pressure-sensitive strokes with on-device handwriting recognition and shape recognition.
- **Page frames** — nested rich-text documents embedded in the canvas (see *Editor* below).
- **PDFs** — embedded with page navigation and zoom.
- **Images** — jpg, png, gif, webp, avif, svg, bmp.
- **Audio** — recorded or imported, with transcription (see below).
- **LaTeX / math** — rendered formulas as canvas elements and as document blocks.
- **Text elements and shapes** — direct-on-canvas text and recognized shapes.

### Editor (rich text)

Page frames are full ProseMirror documents: headings, bullet/ordered lists, checklists, blockquotes, tables, code blocks, math blocks, horizontal rules, and inline formatting (bold, italic, underline, strikethrough, inline code, color, font family, note links, external links, mentions).

### Runnable code blocks (notebook-style)

Code blocks execute **locally** on your machine — no cloud runtime. Within a page frame, blocks share context org-mode style: blocks up to the one you run are concatenated in order, so state defined earlier is available later. Supported languages today: **Python, JavaScript, TypeScript, Ruby, Bash, Go, Rust, C, C++** (compiled languages auto-detect a system toolchain). Output streams live, and runs are cancellable.

### Search

- **Full-text search** — fast client-side index with fuzzy and prefix matching.
- **Semantic search** — on-device embedding search (BERT via Candle), computed locally per repository. No content leaves the machine.

### Audio transcription

Live transcription while recording, or batch transcription of imported audio, using a local Whisper model.

### Export

- **PDF** — full visual export of the canvas (ink, text, images, embedded PDFs, rendered LaTeX, custom fonts).
- **Markdown / Obsidian vault** — page-frame content serialized to Markdown with YAML frontmatter, folder structure, and copied media (canvas-only elements like raw ink are omitted in this path).

### Sync

- **Local** — notes live on disk as the source of truth; works fully offline.
- **GitHub** — sync through a Git repository you own, with branch handling and CRDT-based conflict resolution.
- **Live sync** — open the same note on two devices that share the GitHub backend and they start co-editing in real time automatically. No setup, no UI to enable — edits propagate device-to-device as they happen.

## Platforms

**Desktop and Mobile: macOS, Windows, Linux, Android, IOS** (one native Tauri 2 app, full feature parity). Myelin is not a web app — there is no browser version, and copy must not imply one. 

## Storage & Ownership

Notes are stored **locally as binary files** (CRDT documents) plus a JSON manifest describing the folder tree, tags, and metadata. Binary storage is deliberate — it's what makes the canvas, live merging, and version history work — so the "plain text you can read in any editor" pitch does **not** apply to Myelin and must not be used.

The ownership promise instead:

- **Local-first.** Your files sit on your disk and work offline. The editor keeps working whether or not you pay.
- **Your GitHub.** Optional sync runs through a repository you own.
- **Open, documented format — a commitment.** Notes are kept in an open format: the on-disk container is binary, but **every note can be exported to a documented JSON format with no data loss**. The format is documented so you can read and rebuild your data without Myelin.

This is the anti-lock-in spine of the product: you can always get everything out, losslessly.

## Early Access & Pricing

Myelin launches into **early access and is free during that period.** This is not a promise that it will be free forever — pricing comes later. The commitment that *does* hold regardless of pricing is the open-format guarantee above: whatever happens commercially, your notes remain exportable, losslessly, to a documented format.