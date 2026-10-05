# Conventions
- This repo uses `yarn` not npm.
- Avoid `// ------ CATEGORY -------` style comments in the code. 3+ of these in a single file may indicate that the file should be split up further — but use critical thinking, sometimes keeping them together is still the right call.
- This is a tauri app, you must test using tauri mcp or computer use, not playwright mcp in browser.
- Do not drive the Tauri application for testing unless the user explicitly asks you to.
- Prefer named concrete types over derived helper types like `Awaited<ReturnType<typeof fn>>` when a clear exported/interface type exists. Use derived types only when tying the type to the function signature is intentionally clearer.

# Guidelines
## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. React Hooks

- Use `useEffect` only to synchronize with external systems like DOM listeners, subscriptions, timers, or imperative APIs.
- When an effect-owned callback needs fresh props or state, prefer `useEffectEvent` over mutable refs or widening the effect dependency list just to keep the callback fresh.
- Do not rely on React Compiler alone for correctness or dependency stability. Use explicit `useMemo` and `useCallback` when stable identity makes effects, context values, imperative handles, subscriptions, or memoized children easier to reason about.
- Avoid wrapping ordinary render-time handlers by default. If a callback is only passed to a plain DOM element and not used as a dependency or stable prop, keep it inline.

## 6. Comments

**Default to none. A comment has to say something the code cannot.**

For every comment, ask: could a competent reader get this by reading the code? If yes, delete it. If no, keep it — as short as it can be and still carry the fact.

Worth keeping:
- Contracts: what a return value of `null` means, what the caller must do first, what is safe to call twice.
- Override behaviour on a base class: what the default does, why a subclass would replace it.
- Why *not* the obvious thing: a rejected alternative and the reason it was rejected.
- Hard-won facts: perf measurements, platform/browser quirks, ordering constraints, floating-point traps.
- Units and coordinate spaces: world vs screen vs CSS px vs PDF points.

Delete on sight:
- Restatements of the identifier or the next line.
- A summary of what the function body does, step by step.
- Prose describing the design in general terms with no fact in it.
- History ("this used to be…") unless it names a trap someone would otherwise re-introduce.

Length: an inline `//` note is 1–2 lines. A `/** */` block earns more only when it documents a contract or a genuinely subtle mechanism. Use `/** */` on exported/public API and interface members so hover docs work; use `//` for implementation notes inside a function or on a private field.

### Bad

```ts
/**
 * Populate the element store from the current Y.Array state.
 * Called once on construction for loaded documents.
 */
private hydrateFromYDoc(): void {
```
The name and the call site already say this. Delete it outright.

```ts
/**
 * Frames of sustained zoom before the background layer leaves the tree, and how
 * long the zoom must hold still before it returns.
 *
 * The layer is wider than the viewport, so WebKit tiles it, and a tiled layer
 * re-rasterizes as its contents scale drifts — which the residual on its
 * transform does for the whole of a pinch, whatever size the pattern is painted
 * at. On an iPad the frames that re-rastered it cost 40.4ms against 19.3ms for
 * the frames that didn't. The frame count keeps a single wheel notch from
 * flickering the grid; the settle window bridges two notches of one gesture.
 */
const BG_ZOOM_GESTURE_FRAMES = 3;
```
One real fact (the measurement) buried in ten lines of narration.

```yaml
# iroh 1.x pulls in hickory-resolver and netdev, which read the system DNS
# and interface config through SystemConfiguration. Their link directives
# are macOS-only, so iOS resolves the _SC* symbols only if declared here.
- sdk: SystemConfiguration.framework
```
Three lines explaining a dependency edge anyone can look up. `# needed for iroh 1.x` is enough — it names the thing to delete this line with, which is all the reader needs.

### Good

```ts
// WebKit re-rasters the tiled bg layer as its scale drifts mid-pinch: 40.4ms vs 19.3ms/frame
// on iPad. Frame count ignores a single wheel notch; settle window bridges two notches.
const BG_ZOOM_GESTURE_FRAMES = 3;
```

```ts
// iOS fires pointercancel, not pointerup, for touches it absorbs into a system gesture; without
// this the active-touch set leaks and blocks future single-finger panning.
window.addEventListener('pointercancel', this._handlePointerUp);
```

```ts
// `null` when empty — the viewport reads that as "no clamp" so fresh documents stay pannable.
public getContentBounds(): DOMRect | null {
```

```ts
// Async-rendering elements (e.g. PDF) override to prepare their raster ahead of `drawThumbnail`.
public async prepareThumbnail(...)
```

### When editing comments

Removing or shortening a comment must not touch a line of code. If a comment turns out to sit above the wrong declaration, move it to the one it describes rather than deleting the fact.
