# Design System Specification: The Curated Workspace

## 1. Overview & Creative North Star
**Creative North Star: Myelin**
This design system moves away from the "software-as-a-utility" aesthetic and toward a "software-as-a-sanctuary" experience. It treats the knowledge management process as a high-end editorial endeavor. We achieve this by rejecting the rigid, boxy constraints of traditional SaaS platforms in favor of **intentional asymmetry, expansive breathing room, and tonal depth.**

The goal is a "Soft Studio" feel: a workspace that is intellectually rigorous yet visually calming. By utilizing high-contrast typography scales and overlapping surface layers, we create a digital environment that feels as tactile and premium as a physical architect’s studio.

---

## 2. Colors: Tonal Atmosphere
The palette is built on a "Soft Studio" foundation of off-whites and slates, punctuated by vibrant, academic accents.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders for sectioning or layout containment.
Structure must be defined solely through:
1. **Background Color Shifts:** Distinguish the sidebar from the canvas using `surface` vs `surface-container-low`.
2. **Negative Space:** Use the Spacing Scale (specifically `8` and `12`) to create clear cognitive boundaries.
3. **Soft Tonal Transitions:** Subtle shifts in grey tones provide all the "structure" a sophisticated user needs.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked sheets of fine paper.
- **Base Level:** `surface` (#f7f9fb) for the Infinite Canvas.
- **In-Set Elements:** `surface-container-low` (#f2f4f6) for recessed areas like search bars.
- **Raised Elements:** `surface-container-lowest` (#ffffff) for active document pages or floating cards.
- **Utility Layers:** `surface-container-highest` (#e0e3e5) for secondary navigation or side-panels.

### The "Glass & Gradient" Rule
To elevate the "Infinite Canvas," use Glassmorphism for floating toolbars and the Wheel Picker.
- **Formula:** `surface_container_lowest` at 80% opacity + `backdrop-blur: 24px`.
- **Signature Texture:** Use a subtle linear gradient on Primary CTAs (from `primary` to `primary_container`) to give buttons a "milled metal" feel rather than a flat plastic look.

---

## 3. Typography: Editorial Authority
We utilize a "Dual-Engine" typography system to distinguish between *managing* knowledge (Inter) and *consuming* knowledge (Newsreader).

- **The Interface (Inter):** Used for labels, titles, and UI controls. It is clinical, legible, and modern.
- *Usage:* `title-md` for folder names, `label-sm` for metadata.
- **The Document (Newsreader):** A high-end serif used for `display`, `headline`, and long-form body text within "Document Mode."
- *Usage:* `headline-lg` for note titles. This creates a psychological shift, signaling to the user that they are now in a "deep work" or "reading" state.

**Hierarchy Note:** Always maintain a high contrast between `display-lg` and `body-md`. The large serif headlines provide the "Editorial" soul of the system.

---

## 4. Elevation & Depth: Tonal Layering
We move beyond shadows to convey hierarchy through **Ambient Depth.**

- **The Layering Principle:** Depth is achieved by "stacking." A `surface-container-lowest` card placed on a `surface-container` background creates an organic lift.
- **Ambient Shadows:** Only used for "floating" objects (Wheel Picker, Context Menus).
- **Specs:** Blur: `32px`, Spread: `0`, Opacity: `6%`, Color: `on_surface`.
- **The "Ghost Border" Fallback:** If a border is required for accessibility (e.g., in high-contrast modes), use `outline_variant` at **15% opacity**. Never use 100% opaque lines.
- **Roundedness:** No fully-rounded (`full`) elements. Use a refined scale: `xl` (0.75rem) for main cards, floating panels, and buttons. `lg` for toolbar icon buttons, the Wheel Picker, and interactive chips. `md` for inline tags. `sm` for small UI inputs.

---

## 5. Components: The Specialized Toolkit

### The Wheel Picker
A signature circular interaction component for tool selection.
- **Style:** `surface_container_lowest` with 85% opacity and a `xl` backdrop blur.
- **Interaction:** Icons use `on_surface_variant`. Upon hover, the segment glows with a subtle `secondary_container` tint.

### Document Cards & Library Lists
- **Rule:** Absolute prohibition of divider lines.
- **Layout:** Use `surface-container-low` for the card background. Separate cards using `spacing-4`.
- **Content:** Title in `title-md` (Inter). Summary in `body-sm` (Inter).
- **Interactive State:** On hover, shift background to `surface-container-lowest` and increase the shadow to the Ambient Shadow spec.

### Specialized Toolbars
- **Canvas Toolbar:** Floating, anchored to the bottom-center. Use `primary` (#1c2738) for the background to make the tools "pop" against the light canvas.
- **Typography:** All labels in `label-md` uppercase with 0.05em letter spacing for an architectural feel.

### Buttons & Inputs
- **Primary Button:** `primary` background with `on_primary` text. `xl` roundedness.
- **Input Fields:** No borders. Use `surface-container-highest` as the fill. Active state is indicated by a subtle `primary` underline (2px) rather than a full box glow.

---

## 6. Interaction States

### Hover
- **Elevated elements** (cards, chips, tags — standalone objects with a solid background): shift background to `surface-container-lowest` and apply the Ambient Shadow (§4). Both changes together convey lift.
- **Inline/flat elements** (list items, toolbar buttons, search bars — things embedded within a container): use the `hover-tint` token (`hover:bg-hover-tint`). Never use pure black (`#000`).

### Active / Toggled
- **Togglable elements** (toolbar buttons, filter chips, semantic tags): distinguish the "on" state through a **background color shift** (e.g., `primary` or `tag-active` fill with `on_primary` text). Do **not** add shadows — shadows are reserved for floating objects (§4).

---

## 7. Do’s and Don’ts

### Do
- **Do** embrace white space. If a layout feels "empty," increase the typography size of the headline rather than adding more decorative elements.
- **Do** use `tertiary_fixed` (Emerald) and `amber` sparingly for "Status" or "Insight" widgets.
- **Do** align serif headlines (Newsreader) to the left to maintain an editorial grid.

### Don’t
- **Don’t** use pure black (#000000). Use `on_surface` (#191c1e) for text to maintain the "Soft Studio" tonal range.
- **Don’t** use shadows on nested elements. Only use shadows for elements that "fly" above the canvas.
- **Don’t** use standard 12-column grids for the Infinite Canvas. Use an asymmetric layout where the primary content is slightly offset to create visual interest.
- **Don't** use generic system icons. Use light-stroke (1.5px) custom icons that match the `inter` stroke weight.