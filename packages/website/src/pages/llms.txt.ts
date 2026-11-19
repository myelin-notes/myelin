import type { APIRoute } from 'astro';
import { siteLinks } from '@/content/site/links';
import { formatPrice } from '@/content/site/prices';

const pro = formatPrice('en', 'pro');
const student = formatPrice('en', 'student');

const body = `# Myelin Notes

> Myelin Notes is a cross-platform note-taking app for Mac, Windows, and Linux that combines handwriting, typed notes, and PDFs on one infinite canvas. It works fully offline, needs no account, stores notes as plain files on your own disk, and is free for personal use.

Myelin Notes is in beta. iPhone, iPad, and Android apps are in closed beta.

## Who it is for

- Students who annotate lecture slides and PDFs, write by hand with a stylus, and record lectures.
- People who want handwriting and typed, Markdown-style notes in the same place instead of two apps.
- People who want their notes local and offline, not held by a cloud service or behind an account.
- Developers and researchers who keep runnable code and Jupyter notebooks next to their notes.

## Key features

- Handwriting: pressure-sensitive pens, palm rejection, shape snapping, a ruler, lasso selection, and pen presets.
- PDFs: write directly on PDFs, quote text into notes with a link back, keep ink anchored to its page, and export the annotated PDF.
- Pages: rich-text documents on the canvas with Markdown shortcuts, tables, checklists, math, Mermaid diagrams, and code blocks.
- Audio: record lectures or meetings on the canvas, transcribed on-device by a bundled Whisper model, and searchable.
- Linked notes: [[note links]], backlinks, hover previews, a graph view, nested tags, and per-note version history.
- Sync and collaboration: sync through a GitHub repo you control, and live peer-to-peer editing over an encrypted connection, with no Myelin server in the middle.
- Import from Goodnotes, OneNote, Obsidian, Notion (Markdown and CSV export), Jupyter, Markdown, and PDFs. Export to PDF, Markdown, an Obsidian vault, or JSON.
- AI: no built-in chatbot. Pro runs a local MCP server so the AI app you already use can read your notes, and write to them only if you allow it.
- Available in English, Spanish, French, and Simplified Chinese.

## Pricing

- Free: for personal use, no time limit, nearly every feature. Notes are never paywalled.
- Pro: one-time purchase of ${pro} (${student} for students), no subscription. Adds AI agents over MCP, runnable code blocks, handwriting recognition for search, more accurate transcription models, and higher limits. One license works on up to 3 devices on any platform.

## Source and license

The source is public on GitHub under the PolyForm Strict 1.0.0 license: free for personal and noncommercial use, but not open source.

## Links

- [Features](https://trymyelin.app/features): full feature list
- [Pricing](https://trymyelin.app/pricing): Free, Pro, and student pricing
- [Try it in your browser](https://trymyelin.app/try): limited web preview of the canvas
- [Download](${siteLinks.releases}): latest release for macOS, Windows, and Linux
- [Source code](${siteLinks.source})
- [Support](https://trymyelin.app/support)
- [Privacy](https://trymyelin.app/privacy)
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
