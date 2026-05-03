# Myelin Note Model Design

## Overview

Myelin is a knowledge management and note-taking app targeting students, teams, small studios, and knowledge workers. This document describes the core note model that underpins the entire app.

The central design insight: **every note is a canvas with page frames.** There is one unified note type. The distinction between "freeform canvas" and "structured document" is a spectrum of usage, not a fundamental type difference.

---

## The Unified Note Model

Every note in Myelin is an infinite 2D canvas. On this canvas, users can:

1. **Draw and write freely** with a stylus or mouse anywhere on the surface
2. **Place elements freely** (PDFs, images, text boxes, shapes) anywhere on the surface
3. **Use page frames** — rectangular document regions where structured content flows linearly across defined pages

A page frame is an element that lives on the canvas. It behaves like a traditional document editor inside its bounds (content flows top-to-bottom, blocks stack vertically, pages break at defined heights), while the canvas space around it is fully usable for freeform annotation, margin notes, sketches, and diagrams.

---

## Page Frames

A page frame is a rectangular region on the canvas with a defined width and height per page. Content inside a page frame flows linearly across pages, similar to a word processor or notebook.

### Properties

- **Fixed page dimensions** (e.g., A4, Letter, or custom sizes)
- **Paginated** — content that overflows one page continues to the next page in the frame
- **Positioned on the canvas** — a page frame has an (x, y) position on the canvas like any other element
- **Scrollable independently** — when focused, scrolling navigates within the frame's pages

### Block Types Within a Page Frame

- **Text** — Rich text with headings, bold/italic, lists, links, inline code
- **Image** — Embedded images that flow within the document
- **Code** — Syntax-highlighted code blocks (executable in a future version)
- **Spacer** — Blank vertical space for additional handwritten notes or breathing room
- **Embed** — Links to other notes, external content, or embedded media

### Multiple Page Frames

The data model supports multiple page frames on a single canvas. This enables workflows like:

- A PDF element on the left, personal notes page frame on the right, with sketches and arrows connecting them on the canvas between
- Lecture slides in one frame, student notes in another, side by side
- Multiple reference documents arranged spatially with synthesis notes in the surrounding canvas space

**Default experience:** When creating a new note, a single page frame is placed centered on the canvas. This looks and feels like a clean, familiar document editor. Most users will only ever use one frame.

**Advanced usage:** Power users can add additional page frames to the same canvas for side-by-side reading, comparative analysis, or multi-document workflows. This is an advanced feature that should be discoverable but not prominent — it should not add complexity to the default single-frame experience.

**Design considerations for multiple frames:**
- How does focus and keyboard input switch between frames?
- How does scrolling behave — scroll within the focused frame, or pan the whole canvas?
- Should frames be resizable and repositionable, or snap to preset layouts (side-by-side, grid)?
- How are multi-frame notes represented in the library (preview/thumbnail)?

---

## Ink Layer

The ink layer is a transparent drawing surface that covers the entire canvas, including the area over page frames. It supports:

- **Freehand drawing** with pressure sensitivity (stylus)
- **Highlighter strokes** with transparency
- **Erasing** individual strokes

### Key Behaviors

- **Stylus auto-activation**: When a stylus touches the screen, the ink layer activates automatically. Finger/mouse input defaults to navigation and text editing. This should be configurable.
- **Spatial anchoring**: Ink strokes drawn on or near a page frame are anchored to page-relative positions. If content above shifts (e.g., more text is inserted), ink strokes below shift with it, keeping annotations aligned with the content they relate to. Ink over fixed-position elements such as PDFs anchors to the element's canvas position.
- **Anywhere drawing**: Users can draw on top of page frames, PDF elements, in the margins just outside a frame, or in the open canvas space between elements. There are no artificial boundaries on where ink can go.

---

## PDF Handling

PDFs are imported as standalone canvas elements. A PDF element owns the imported PDF bytes, file name, page metadata, page order, and any visual page slices needed for presentation.

PDFs do not become page-frame blocks. They live on the same infinite canvas as page frames, images, strokes, and text boxes. This keeps PDF rendering independent from the structured document editor while still allowing users to annotate, arrange, resize, and relate PDFs spatially.

### Annotation

- The ink layer allows drawing directly on top of any PDF page (highlights, underlines, handwritten notes).
- Typed annotations are separate canvas elements or page-frame content placed beside, above, below, or over the PDF element.
- PDF annotations in Myelin are non-destructive by default: the original PDF bytes are preserved, and Myelin-owned marks remain separate until an explicit export operation flattens or writes them.

### Page Splitting

Users can visually split a PDF page at a chosen y-coordinate, cutting it into two rendered slices with a gap between them. This allows writing or drawing in the space between sections of a dense PDF page.

- The split is a visual operation — the page is rendered as two cropped regions, not a semantic reflow of PDF content
- Works with any PDF regardless of layout complexity
- The gap is canvas space. It can contain handwritten strokes, text elements, images, or a nearby page frame

### Relationship to Page Frames

PDF elements and page frames are peers. A common research workflow is to place a PDF element next to a page frame, use the frame for structured notes, and draw connecting marks on the canvas between them.

---

## Usage Modes

There is only one note type. However, the UI presents different starting contexts:

| Mode | What it means | When to use |
|------|--------------|-------------|
| **Document** | A single page frame is centered and prominent. The surrounding canvas is available but secondary. The experience feels like a clean document editor. | Writing, note-taking, PDF annotation, structured work |
| **Board** | No page frame is shown by default. The full canvas is the primary surface. Elements are placed freely. | Brainstorming, mind mapping, mood boards, spatial organization, multi-document layouts |

These are **view presets**, not different data models. A user can start in Document mode and expand into Board mode at any time. They can add a page frame to a Board, or start drawing freely outside the frame in a Document. The underlying data structure is identical.

---

## What This Looks Like — Example Scenarios

**Student taking lecture notes:**
A single page frame, centered. The student types headings and bullet points into the frame. When the professor draws a diagram on the board, the student sketches it with a stylus in the margin space next to the relevant paragraph. Both live in the same note.

**Researcher reading a paper:**
A PDF element and a page frame side by side. The PDF element contains the paper. The page frame contains the researcher's notes. On the canvas between them, the researcher draws arrows connecting specific passages to their notes and sketches a concept diagram.

**Designer building a mood board:**
Board mode, no page frames. Images, text boxes, and color swatches are placed freely on the canvas. The designer draws circles and arrows to group and connect ideas. Later, they add a page frame to write a structured design brief alongside the mood board.

**Annotating a dense PDF:**
A PDF element is centered on the canvas. The student draws highlights and margin notes with a stylus on top of the PDF pages. At one point, they split a dense page in half to create space and write a detailed explanation between two rendered slices. They place a text box or page frame nearby for longer notes.

---

## Cross-Note Features

### Embedding
- Notes can embed references to other notes (displayed as a card or preview)
- In Board mode, this enables pinning multiple note previews to the canvas
- In Document mode, this enables inline references within the page frame

### Linking
- Bidirectional links between notes (`[[Note Name]]` syntax in text blocks)
- Backlinks panel showing all notes that reference the current note

### Tags
- Notes can be tagged for organization and filtering
- Tags are searchable and browsable from the library

---

## Key Design Principles

1. **One model, not two.** There is one note type. "Document" and "Board" are usage modes of the same underlying structure. Users never have to choose a type upfront or convert between types.

2. **The canvas is the foundation.** Everything lives on an infinite 2D surface. Page frames are elements on that surface, not a separate system.

3. **Ink goes everywhere.** Users can draw and write with a stylus anywhere — inside page frames, in the margins, in the open canvas. No artificial boundaries.

4. **Page frames bring structure.** Inside a page frame, content flows linearly across defined pages. This provides a familiar document editing experience without sacrificing the flexibility of the surrounding canvas.

5. **PDFs are first-class canvas elements.** Imported PDFs remain independent from page frames while sharing the same canvas, selection, positioning, annotation, and export model. No special "PDF mode" is needed.

6. **Progressive disclosure.** A new user sees a clean, single-frame document editor. The canvas space, ink layer, multi-frame layouts, and board mode are available but don't clutter the default experience. The app should feel as simple as Apple Notes on first use and as powerful as needed when the user is ready.
