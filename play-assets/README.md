# Play Store screenshots

Generated from the real app driven over the Tauri MCP bridge, with the demo
library created through Myelin's own MCP server (`create_folder`, `create_note`,
`edit_tags` on `127.0.0.1:3846`). Ink was drawn by dispatching synthetic
`pointerType: 'pen'` events at varying pressure, so the strokes are real
`StrokeElement`s, not mockups.

| Set | Files | Size | Ratio | Viewport | DPR |
| --- | --- | --- | --- | --- | --- |
| `phone/` | 2 | 1080x1920 | 9:16 | 576dp | 1.875 |
| `tablet-7/` | 6 | 1920x1080 | 16:9 | 960dp | 2.0 |
| `tablet-10/` | 6 | 2560x1440 | 16:9 | 1024dp | 2.5 |

The 10-inch set is at DPR 2.5 because a real 10-inch tablet applies the 1.25x
touch scaling from `applyMobileViewportScale` (2.0 device DPR x 1.25). The
7-inch set is at a plain 2.0 because a real 7-inch tablet does **not** apply it,
so those shots match what that device class actually renders today.

## How to reproduce

The dev server is unusable for this: its HMR loop reloads the webview every
30-60s, wiping open tabs and injected helpers mid-capture, and `IS_DEV` adds
overlays that never ship. Build the frontend and serve it instead, then run the
already-compiled debug binary against it. The MCP bridge is
`#[cfg(debug_assertions)]`, so the debug binary keeps automation while the
frontend is production.

```sh
VITE_TABLET_LAYOUT=true npx vite build
npx vite preview --port 1420 --strictPort          # devUrl the binary expects

WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--force-device-scale-factor=2.0" \
  ./src-tauri/target/debug/myelin.exe
```

Then size the window in *physical* pixels (`manage_window` with
`logical: false`). The forced scale factor makes the logical viewport match a
device while the framebuffer stays at the target resolution; without it a
1080x1920 window renders a 720dp viewport, which is neither a phone nor a
tablet.

Gotchas: the window must not be minimized or resizes are silently ignored.
Every tab's canvas stays mounted, so find the active one by filtering for a
laid-out, on-screen canvas. The production bundle is minified, so identify
element types by duck typing (`'_pageWidth' in el` for a page frame), not by
`constructor.name`. UI clicks need a full pointerdown/mousedown/pointerup/
mouseup/click sequence; a bare `.click()` is ignored in places.

## Things suppressed for capture

Only two, via an injected stylesheet, because neither ships on Android:

- The frameless window controls (`WindowControls`, Windows only).
- Scrollbars.

The `IS_DEV` overlays (fps readout, Peer Sync panel) are absent on their own
because the frontend is a production build.

## Known bugs these shots had to work around

- **Search snippets render raw markup.** Results show `<bold>1 um</bold>` and
  `<noteLink title="Myelination...` as literal text. It is in the indexed
  content itself, not just the UI: the MCP `search_notes` `contentSnippet` has
  the same markup. The search shots use a query whose visible snippets truncate
  before any markup.
- **Graph nodes do not hit-test synthetic pointer events**, so the 7-inch graph
  scene could not get a populated inspector and was replaced with the library.
  The 10-inch set omits graph for the same reason.
