# Conventions
- This repo uses `yarn` not npm.
- Avoid `// ------ CATEGORY -------` style comments in the code. 3+ of these in a single file may indicate that the file should be split up further — but use critical thinking, sometimes keeping them together is still the right call.
- This is a tauri app, you must test using tauri mcp or computer use, not playwright mcp in browser.
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
