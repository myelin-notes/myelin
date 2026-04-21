# Plan: Product Boundaries

## Context

This document turns the commercialization plan into explicit product boundaries.

The purpose is to prevent Myelin from drifting into:

- a watered-down free plan that users do not trust
- a premium plan that is too cheap to sustain the product
- a roadmap that tries to serve students, enterprises, and teams all at once
- infrastructure and feature work that does not match the business model

This is a living decision record. Some boundaries are already recommended. Others are still open and need founder decisions.

**Related document**: `docs/commercialization-plan.md`

## Core Principle

Myelin should be a **local-first prosumer product** with a strong free core and a paid convenience layer.

It should not become a general-purpose B2B workspace product unless that happens later as a deliberate second act.

## Recommended Default Position

If no better information emerges, the default position should be:

- free core note-taking stays generous
- BYO sync remains available
- paid plans monetize managed convenience, retrieval, and workflow polish
- launch audience is serious students, researchers, and technical prosumers
- team and enterprise features stay out of the first paid launch

## Boundary Ledger

| Boundary | Recommendation | Why | Status |
| --- | --- | --- | --- |
| Free vs paid | Keep creation, editing, import/export, local-first usage, and BYO sync free | Trust and adoption depend on ownership staying real | Proposed |
| Paid value | Charge for managed cloud sync, history, OCR/search, and premium workflows | These save time and reduce anxiety without feeling extractive | Proposed |
| Myelin accounts | Require Myelin accounts only for first-party cloud and payments, not for local/BYO users | This preserves the low-friction local-first adoption path | Decided |
| Audience | Launch for serious students, graduate researchers, and technical readers/writers, with a strong but non-exclusive research/study wedge | They genuinely need typed + handwritten notes in one live note | Decided |
| Teams | Keep team admin and enterprise features out of the first paid launch, but include lightweight shared lab/notebook exploration in the next 12 months | This allows limited expansion without turning Myelin into an enterprise product | Decided |
| AI | Keep AI optional and secondary | AI is expensive, generic, and not the core reason Myelin is special | Proposed |
| BYO sync | Keep GitHub or similar BYO sync available, including private repos | It reinforces the local-first trust model without making free sync artificially useless | Decided |
| Search claim | Do not market "knowledge management" aggressively until full-content search ships | Title/tag search alone is too shallow | Proposed |
| OCR claim | Do not sell OCR as premium until it is cross-platform and user-visible | Current state is not strong enough for a headline promise | Proposed |
| Pricing floor | Do not price managed sync at commodity throwaway levels | Underpricing makes the business fragile and devalues the product | Proposed |
| Public promise | Promise note ownership and a useful free plan | Trust is part of the product | Proposed |

## Detailed Boundaries

### 1. Ownership Boundary

#### Recommendation

Users should be able to trust that:

- their notes are theirs
- the app remains useful without subscribing
- they are not forced into first-party cloud to keep using the product seriously

#### Implications

The following should remain available on the free plan:

- unlimited local notes
- local-first editing
- PDF/image/Markdown import and export
- hybrid typed + ink workflows
- offline use
- BYO sync path

The following should **not** be included on the free plan at launch:

- first-party Myelin cloud repositories
- free hosted sync/storage from Myelin

#### Why this matters

This is not just philosophy. It is also part of conversion.

If users do not trust ownership, they hesitate to adopt Myelin deeply.
If they do trust ownership, they are much more willing to pay for convenience later.

### 1.5. Account Boundary

#### Recommendation

Myelin accounts should be required only for:

- first-party cloud sync
- payments
- entitlement management
- restore/version history tied to Myelin-hosted storage

Myelin accounts should **not** be required for:

- local-only usage
- BYO sync usage
- trying the core product

#### Why this matters

If users have to create an account before they get value, Myelin starts to feel like another SaaS app instead of a local-first tool.

The account wall should appear only when users choose a Myelin-hosted convenience feature.

### 2. Monetization Boundary

#### Recommendation

Myelin should monetize convenience, not captivity.

Charge for:

- managed cloud sync
- easy multi-device onboarding
- restore/version history
- OCR indexing and search
- premium retrieval workflows
- premium research/technical workflows

Do not charge for:

- basic note creation
- basic handwriting
- basic document editing
- local note access
- basic import/export

Do not create artificial paid pressure by making BYO sync practically unusable for normal personal notes.

#### Why this matters

This keeps the business model aligned with the product architecture.

Myelin is already designed to keep infra relatively low by staying local-first and avoiding a heavy central collaborative backend. The pricing model should benefit from that instead of fighting it.

### 3. Audience Boundary

#### Recommendation

The first serious launch audience should be:

- serious students
- graduate students
- researchers
- technical readers and writers

These users are the best fit because they often:

- move between laptop and tablet
- work with PDFs
- combine structured text with sketches or markup
- care about retrieval and source-linked notes

#### What this excludes for now

Do not optimize the early product or marketing around:

- generic business teams
- enterprise knowledge management
- operations/sales/marketing workflows
- whiteboard facilitation for large groups

#### Public positioning decision

Lean into the research/academic wedge strongly, but not exclusively.

Recommended public framing:

- "built for serious study, reading, and research"
- "for people who think with text, ink, PDFs, and diagrams"

Avoid framing like:

- "only for academics"
- "lab notebook software" as the top-level identity

### 4. Team Boundary

#### Recommendation

The first paid launch should not depend on:

- team workspaces
- seat management
- admin consoles
- SSO
- compliance packaging

#### Why this matters

Those features may be valuable later, but they create a completely different product and support burden.

If Myelin can become a meaningful solo business first, you will have the option to add light team functionality later from a position of strength.

#### 12-month decision

Include lightweight shared lab/notebook features in the next 12 months, but constrain them tightly.

Allowed scope:

- shared notebooks or shared spaces for very small groups
- invite collaborators by email or share link
- notebook-level permissions such as owner/editor/viewer
- basic shared history or activity visibility
- simple shared sync and recovery flows
- very lightweight lab billing if needed for a small paid group plan

Disallowed scope inside this 12-month window unless strategy changes:

- inline comments and mention systems
- task/project management layers
- organization admin consoles
- complex seat management
- SSO
- enterprise compliance packaging
- broad workplace collaboration features
- generic team operating system ambitions

This keeps the decision pointed at a narrow extension of the research wedge rather than a second product.

### 5. Search Boundary

#### Recommendation

Myelin should not lean heavily on "knowledge management" messaging until it supports:

- full-content note search
- PDF text search
- OCR text search
- a retrieval experience that beats title/tag-only organization

#### Why this matters

Knowledge management lives or dies on retrieval.

Without strong retrieval, Myelin is primarily a note-creation environment.
With strong retrieval, it becomes a system users can rely on long-term.

### 5.5. Version History Boundary

#### Definition

Version history does **not** mean undo/redo.

Undo/redo is:

- session-level editing reversal
- immediate
- typically local to the current editing context

Version history is:

- persistent restore points across sessions and devices
- the ability to recover older note states from hours or days ago
- protection against accidental deletion, destructive edits, sync mistakes, and device loss

#### Recommendation

For the first paid launch:

- keep undo/redo as part of the core editing experience
- keep meaningful persistent version history and restore as a paid feature

#### Why this matters

Version history is one of the cleanest premium convenience features Myelin can offer because it:

- provides real user safety
- does not compromise ownership
- clearly differs from basic editing
- is much more valuable once users trust Myelin with important notes

### 6. OCR Boundary

#### Recommendation

OCR should be treated as:

- an important enabling feature
- a paid convenience candidate
- not a core headline until it works well across platforms

#### Product rule

Do not make OCR a monetization pillar until users can clearly see:

- when OCR ran
- what text was extracted
- how it affects search
- what happens when it fails

### 7. AI Boundary

#### Recommendation

AI should stay optional, later, and clearly subordinate to the core product.

If added, AI should help with:

- summaries
- study aids
- retrieval assistance
- source synthesis

It should not define the pricing model and should not become the main reason to buy Myelin.

#### Why this matters

AI margins are weaker, the UX is easier to copy, and it distracts from the product's actual differentiation.

### 8. Pricing Boundary

#### Recommendation

The first paid personal plan should be priced like a serious tool, not a throwaway utility.

Working default recommendation:

- Pro: `$8/month` or `$72/year`
- Student/Educator Pro: `$4/month` or `$36/year`

#### Pricing floor rule

Do not launch managed cloud at an ultra-low price like `$2/month`.

That price point:

- makes it harder to fund support and product work
- attracts users who are less committed
- trains the market to think Myelin is a cheap utility instead of a serious tool

### 9. Launch Boundary

#### Recommendation

The first paid launch only needs:

- managed cloud sync
- accounts and billing
- version history/restore
- meaningful search improvement
- clear free vs paid boundaries users consider fair

It does **not** need:

- teams
- enterprise compliance features
- deep integrations
- AI-first features

### 10. Public Promise Boundary

#### Recommendation

Myelin should publicly promise:

- local-first principles
- note ownership
- useful free plan
- BYO sync remains available

Myelin should not publicly promise:

- enterprise readiness on a near timeline
- becoming a universal workplace platform
- AI as the center of the roadmap

## Remaining Open Decisions

These are the founder decisions that still matter most right now.

### A. Pro Workflow Boundary

Question:

What extra workflow value should be included in Pro at the first paid launch beyond managed sync/history/search?

Recommendation:

For the first paid launch, keep Pro narrow:

- managed cloud sync
- persistent version history/restore
- OCR-backed retrieval
- stronger search

Delay most research workflow polish until after paid validation.

Why:

If Pro includes too many speculative workflow features at launch, scope grows faster than revenue certainty.

### B. Trial Boundary

Question:

Should Myelin offer a free trial of paid cloud features, and if so how aggressive should it be?

Recommendation:

- Yes, offer a cloud trial.
- Default recommendation: 14-day trial for managed sync/history/search features.
- Do not offer a permanent free first-party cloud tier at launch.

Why:

Users need to experience the convenience to value it, but the free plan should not permanently absorb the main paid feature.

### C. Publish/Share Boundary

Question:

Should read-only publish/share be part of the first paid launch, a later Pro feature, or a lab-only feature?

Recommendation:

- Do not make it part of the first paid launch.
- Consider it as a later Pro or lab feature once sync/history/search are stable.

Why:

It is useful, but not core to validating whether users will pay for Myelin's strongest convenience layer.

## Decision Log

Use this section to convert open boundaries into explicit calls.

| Date | Boundary | Decision | Notes |
| --- | --- | --- | --- |
| 2026-04-20 | Free-forever boundary | Undo/redo is core; meaningful persistent version history is paid | Version history means persistent restore, not basic undo |
| 2026-04-20 | BYO sync boundary | BYO sync stays free, including private repos | Do not sabotage BYO by forcing public repos |
| 2026-04-20 | Student plan timing | Same entitlement as Pro; launch same time if operationally easy | If not, ship immediately after Pro |
| 2026-04-20 | Research wedge strength | Strong wedge, but non-exclusive identity | Position around serious study, reading, and research |
| 2026-04-20 | Team expansion timing | Include lightweight shared lab/notebook features within 12 months | Keep scope explicitly small and non-enterprise |
| 2026-04-20 | Free first-party cloud boundary | No free first-party cloud repos at launch | Free = local-first + BYO sync |
| 2026-04-20 | Account requirement boundary | Accounts required only for cloud/payments | Do not require accounts for local/BYO users |
| 2026-04-20 | Lab scope boundary | Allow narrow shared notebook features only | Invites, notebook permissions, basic shared activity, simple group billing if needed |

## Next Step

Resolve the top boundary decisions in this order:

1. Pro workflow boundary
2. Trial boundary
3. Publish/share boundary

These decisions directly shape:

- pricing page copy
- roadmap scope
- launch messaging
- billing implementation
