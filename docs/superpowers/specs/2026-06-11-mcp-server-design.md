# Myelin MCP Server Design

## Goal

Add a local MCP server to Myelin so AI agents can safely inspect and update the user's notes through the running desktop app. The server should feel similar to Figma's desktop MCP: user-controlled, local, and focused on exposing application state rather than requiring agents to parse private storage files directly.

The first implementation should support:

- listing notes
- reading note structure and selected note content
- reading heavy note elements on demand
- creating and modifying page-frame content through explicit write tools

## Assumptions

- The MCP server is desktop-only for now.
- The server is disabled by default and must be enabled by the user.
- The server binds to `127.0.0.1`, not a public interface.
- A command-line flag can start or enable the server for development and agent configuration, but normal users control it from Settings.
- The first write paths are page-frame creation and markdown replacement, not arbitrary canvas mutation.
- `read_note` is for agent understanding, not a lossless export format.

## Non-Goals

- No cloud-hosted MCP endpoint.
- No mobile MCP server.
- No direct mutation of raw Yjs updates by agents.
- No broad "edit anything" tool in the first version.
- No full OCR, PDF text extraction, or image captioning unless already available from the app's index or metadata.

## Recommended Approach

Use a staged read model.

`list_notes` should stay compact so agents can discover likely targets without flooding context. `read_note` should provide a structured inventory of the note, enough for an agent to understand what exists and what to fetch next. Heavy content should live behind element-specific readers such as `read_page_frame`, `read_image`, and `read_pdf`. A convenience `read_note_full` can assemble everything for the common "summarize this entire note" workflow.

This produces better agent output than either extreme:

- Returning everything from `read_note` wastes context and makes agents less precise.
- Returning only ids/titles forces agents to guess which content matters and often causes incomplete summaries.

## Transport and Launch Model

Use MCP Streamable HTTP over localhost.

Behavior:

- Settings expose an "Enable MCP server" control.
- When enabled, Myelin starts a local HTTP MCP endpoint at `http://127.0.0.1:3846/mcp` by default.
- The app shows connection details and copyable client configuration.
- The server stops when the setting is disabled or the desktop app exits.
- A CLI flag, for example `--mcp` or `--mcp-port <port>`, may enable the same server for development.
- The port is configurable, but Myelin should not silently auto-pick a random port because MCP clients need stable configuration.

The server should not run silently for every desktop session.

## Architecture

The MCP server should call the existing repository/session layer rather than reading storage files directly.

Relevant existing boundaries:

- Repository abstraction lists files, folders, tags, recents, backlinks, and note bytes.
- Notes are stored as Yjs `.mcanvas` documents.
- Page-frame markdown import/export already exists.
- The Rust note index already extracts searchable text from page frames and standalone text elements.

Proposed modules:

- `src/lib/mcp/read-model.ts`
  Builds structured note snapshots from repository nodes and Yjs note bytes.

- `src/lib/mcp/tools.ts`
  Defines tool input/output schemas and delegates to read/write services.

- `src/lib/mcp/server.ts`
  Owns MCP protocol handling and exposes the localhost endpoint.

- `src/lib/mcp/settings.ts`
  Stores enablement, port, and write-confirmation preferences.

Rust should host the localhost MCP transport because the webview cannot directly bind an HTTP listener. Tool execution should stay in the frontend where the active repository/session layer already exists. The bridge should work as request/response IPC:

- Rust receives an MCP tool call.
- Rust emits an internal Tauri event with a request id, tool name, and arguments.
- The frontend MCP service handles the request through the existing repository APIs.
- The frontend sends the result or error back through a Tauri command.
- Rust completes the MCP response.

If the frontend is not ready or no repository is active, tool calls should fail with a clear "Myelin is not ready" tool error. Do not duplicate repository parsing in Rust for the first version.

## Tool Surface

### `list_notes`

Input:

- optional query
- optional folder id
- optional tag filter
- optional limit

Output:

- note id
- title
- folder path
- file type
- tags
- created/modified timestamps
- short indexed preview when available

Only `.mcanvas` files are notes for the initial MCP surface.

### `read_note`

Input:

- note id

Output:

- note metadata
- cached indexed text when available
- page-frame inventory
- standalone text inventory
- image inventory
- PDF inventory
- LaTeX inventory
- stroke/drawing inventory
- unknown element inventory

`read_note` should not include full heavy content by default. It should include snippets and element ids so agents can decide what to read next.

Example shape:

```ts
{
  note: {
    id: string;
    title: string;
    path: string[];
    tags: string[];
    createdAt: number;
    modifiedAt: number;
  };
  indexedText: string | null;
  elements: Array<
    | PageFrameSummary
    | TextElementSummary
    | ImageSummary
    | PdfSummary
    | LatexSummary
    | StrokeGroupSummary
    | UnknownElementSummary
  >;
}
```

### `read_page_frame`

Input:

- note id
- page frame id

Output:

- page frame id
- display name
- bounds/layout
- markdown
- plain text

Use existing page-frame markdown serialization where possible.

### `read_image`

Input:

- note id
- image element id
- optional mode: metadata, thumbnail, full

Output:

- image metadata
- bounds
- mime type if known
- dimensions if known
- MCP resource URI for thumbnail or full image data when requested

Default to metadata. Thumbnail and full image data should be opt-in because they can consume large context and bandwidth.

### `read_pdf`

Input:

- note id
- PDF element id
- optional page range
- optional mode: metadata, text, image

Output:

- PDF metadata
- bounds
- page count when known
- source filename or asset id when known
- extracted text if available
- MCP resource URIs for rendered page images only when explicitly requested

If text extraction is not yet available, return metadata plus a clear `textAvailable: false` field rather than pretending the agent has the PDF contents.

### `read_canvas_text`

Input:

- note id
- text element id

Output:

- text
- bounds
- style metadata where available

This keeps floating canvas text symmetric with `read_page_frame`.

### `read_latex`

Input:

- note id
- LaTeX element id

Output:

- source string
- display mode if known
- bounds

### `read_note_full`

Input:

- note id
- optional include images
- optional include PDFs

Output:

- `read_note` output
- all page-frame markdown/plain text
- all standalone text and LaTeX source
- selected image/PDF data only when explicitly requested

Agents should use this for "summarize the entire note" and avoid it for discovery.

### `create_page_frame`

Input:

- note id
- markdown
- optional display name
- optional placement: `default`, explicit `x/y`, or relative to an existing element id

Behavior:

- opens a repository note session
- adds a new page-frame element to the note
- parses markdown into the new page-frame fragment
- saves the session
- returns the new page frame id so the agent can read or edit it later

Default placement should be deterministic and simple. If no placement is provided, place the new frame near the existing content using the same defaults as Markdown import, offset as needed to avoid exactly overlapping the first frame. Agents can pass explicit coordinates only when they intentionally care about spatial layout.

Output:

- note id
- page frame id
- display name
- bounds/layout
- modified timestamp or revision when available

This is an explicit write tool, not part of `replace_page_frame_markdown`, because adding a new spatial element has different layout and confirmation behavior from replacing an existing frame's content.

### `replace_page_frame_markdown`

Input:

- note id
- page frame id
- markdown
- optional expected revision/state token

Behavior:

- opens a repository note session
- replaces the target page-frame fragment with parsed markdown
- saves the session
- updates note links through the existing markdown import/normalization path

Output:

- note id
- page frame id
- modified timestamp or revision when available

This write tool is explicit, reviewable, and built on existing import code.

## Read Model Details

`read_note` should be generated from the actual Yjs note bytes. The note index may be included as cached `indexedText`, but it should not be the source of truth.

Reasoning:

- The index is async and debounced, so it may lag a recent edit.
- The current index is intentionally lossy.
- The index currently extracts page-frame text and standalone canvas text, but not enough context for layout, PDFs, images, drawings, LaTeX, or unknown elements.

The structured read model should inspect the Yjs `elements` array and emit:

- stable element id/uuid
- element type
- bounds or approximate bounds
- human-readable summary/snippet
- reader tool name to fetch full content

Unknown elements should be included with type/id/bounds where possible so agents know the note contains content they cannot fully inspect yet.

## Write Safety

The default should be conservative:

- MCP must be explicitly enabled.
- Read tools can run without per-call confirmation once enabled.
- Write tools require in-app confirmation by default.
- A separate "allow direct MCP writes" setting can bypass per-write confirmation for users who intentionally want agent automation.
- Write tools should create or preserve version history using existing repository behavior.
- Failed writes should not leave open sessions.

Direct writes are never enabled implicitly by turning on read access.

## Testing

Unit tests:

- read-model extraction for page frames, floating text, images, PDFs, LaTeX, strokes, and unknown elements
- `read_note` includes indexed text when available but still works without it
- `read_page_frame` serializes markdown correctly
- `create_page_frame` adds one new frame with parsed markdown and deterministic placement
- `replace_page_frame_markdown` updates only the target frame
- invalid note ids and element ids return clear tool errors

Integration tests:

- MCP server starts only when enabled or launched with the CLI flag
- MCP tools operate against a fixture repository
- write tools save through repository sessions and update modified time/index requests

Manual Tauri verification:

- enable server in desktop app
- connect an MCP client or inspector to localhost
- list notes
- read a note inventory
- read an individual page frame/image/PDF metadata
- create a new page frame and confirm it appears in the note
- replace a page frame and confirm the UI updates after reopening or refreshing

## Fixed Defaults

- Default endpoint: `http://127.0.0.1:3846/mcp`.
- Port behavior: fixed default, user-configurable, no silent random port.
- Transport host: Rust.
- Tool execution: frontend repository/session bridge.
- Write behavior: confirmation required by default; direct writes require a separate explicit setting.
- Large binary content: MCP resource URIs, not inline base64 by default.
