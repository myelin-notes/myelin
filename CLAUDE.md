This repo uses `yarn` not npm.

## Hover conventions

- **Elevated elements** (cards, chips, tags — things with a solid background that look like standalone objects): use `hover:shadow-md` to deepen their elevation.
- **Inline/flat elements** (list items, toolbar buttons, search bars — things embedded within a container): use `hover:bg-black/5` for a subtle background tint.

## Active/toggled state conventions

- **Togglable elements** (toolbar buttons, filter chips, semantic tags — anything that can be "on" or "off"): add `shadow-md` to the active state to give it a lifted, pressed-in look that distinguishes it from its inactive siblings.