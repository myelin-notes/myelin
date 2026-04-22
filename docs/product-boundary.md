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
- bring-your-own sync remains available (GitHub, Google Drive, or self-hosted)
- paid plans monetize managed convenience, retrieval, and workflow polish
- launch audience is serious students, researchers, and technical prosumers
- team and enterprise features stay out of the first paid launch

## Boundary Ledger

| Boundary | Recommendation | Why | Status |
| --- | --- | --- | --- |
| Free vs paid | Keep creation, editing, import/export, local-first usage, and bring-your-own sync (GitHub, Google Drive, self-hosted) free | Trust and adoption depend on ownership staying real | Proposed |
| Paid value | Charge for managed cloud sync, history, OCR/search, and premium workflows | These save time and reduce anxiety without feeling extractive | Proposed |
| Myelin accounts | Require Myelin accounts only for first-party cloud and payments, not for local/BYO users | This preserves the low-friction local-first adoption path | Decided |
| Audience | Launch for serious students, graduate researchers, and technical readers/writers, with a strong but non-exclusive research/study wedge | They genuinely need typed + handwritten notes in one live note | Decided |
| Teams | Keep team admin and enterprise features out of the first paid launch, but include lightweight shared lab/notebook exploration in the next 12 months | This allows limited expansion without turning Myelin into an enterprise product | Decided |
| AI | Keep AI optional and secondary | AI is expensive, generic, and not the core reason Myelin is special | Proposed |
| Bring-your-own sync | Keep free bring-your-own sync across GitHub, Google Drive, and self-hosted servers | It reinforces the local-first trust model and avoids lock-in to a single backend | Decided |
| Search claim | Full-content search ships at paid launch; knowledge-management framing is allowed once it does | Shipped retrieval makes the claim honest | Decided |
| Semantic search | Semantic search is valuable, but it follows search foundation rather than replacing it | Users trust semantic retrieval only after exact retrieval works well | Decided |
| OCR claim | Cross-platform, user-visible OCR ships at paid launch; OCR-backed retrieval is a legitimate premium headline | Shipped state supports the promise | Decided |
| Pricing floor | Do not price managed sync at commodity throwaway levels | Underpricing makes the business fragile and devalues the product | Proposed |
| Public promise | Promise note ownership and a useful free plan | Trust is part of the product | Proposed |
| Patron tier | Offer an optional recurring supporter tier at $15/month or $144/year, above Pro, with ongoing perks (beta access, monthly founder log, name credit, roadmap input) | Voluntary supporter revenue aligned with indie-first trajectory, without locking critical features behind it | Decided |

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
- bring-your-own sync path (GitHub, Google Drive, or self-hosted)

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
- bring-your-own sync usage
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

Do not create artificial paid pressure by making bring-your-own sync practically unusable for normal personal notes.

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

Full-content search, PDF text search, and OCR text search all ship as part of the first paid launch. Knowledge-management framing is therefore allowed in public messaging from that point on.

Scope that must be working at launch:

- full-content note search
- PDF text search
- OCR text search
- retrieval that clearly beats title/tag-only organization

#### Why this matters

Knowledge management lives or dies on retrieval.

Because strong retrieval ships at launch, Myelin can credibly be positioned as a system users rely on long-term, not just a note-creation environment.

### 5.25. Semantic Search Boundary

#### Recommendation

Semantic search is useful and should be built, but only after standard retrieval is solid.

Build order:

1. full-text search
2. PDF/OCR indexing
3. filters, ranking, and result snippets
4. semantic search on top of that foundation

#### What semantic search is for

Semantic search should help users:

- find notes by concept, not just exact wording
- discover related notes and papers
- surface semantically similar sources
- recover ideas when they only remember the topic loosely

#### Product rule

Do not position semantic search as a replacement for normal search.

It should be:

- a second-layer retrieval tool
- especially valuable for research/study workflows
- additive to deterministic search, not a substitute for it

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

OCR ships cross-platform at the first paid launch and is a legitimate Pro headline alongside search.

At launch, users must be able to see:

- when OCR ran
- what text was extracted
- how it affects search
- what happens when it fails

#### Product rule

Do not market OCR separately from retrieval. Frame it as what makes search work across handwriting and scanned PDFs, not as a standalone feature.

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
- bring-your-own sync remains available (GitHub, Google Drive, or self-hosted)

Myelin should not publicly promise:

- enterprise readiness on a near timeline
- becoming a universal workplace platform
- AI as the center of the roadmap

### 11. Patron Boundary

#### Recommendation

Offer an optional Patron subscription above Pro for users who want to back Myelin beyond the standard paid plan.

- Price: `$15/month` or `$144/year`
- Entitlements: everything in Pro, plus early-access beta channel, monthly founder build log (by email), name credit on a supporters page (opt-in), quarterly roadmap-input survey, in-app Patron badge
- Lapse behavior: on cancellation, the account drops to Free. If the user wants Pro features back, they subscribe to Pro separately

#### Why this matters

Patron provides:

- voluntary additional revenue from the most committed users
- a credible indie-first story — users can directly back the product
- a forcing function for founder transparency (monthly build log)
- a way to route roadmap input from the highest-commitment users

#### What Patron must not be

- a premium version of Pro — critical features must never live behind Patron
- a one-time onboarding reward bundle — perks should feel ongoing (monthly log, quarterly survey)
- part of the core plan grid — Patron is presented separately from Free/Pro/Student so the main pricing decision stays a binary

#### Positioning

Frame Patron as "back the product beyond Pro," not as the next rung on the pricing ladder. Visual treatment on the pricing page should be a distinct block below the three main plans, with its own CTA.

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
| 2026-04-20 | Bring-your-own sync boundary | Bring-your-own sync stays free across GitHub, Google Drive, and self-hosted targets | Multiple backends reinforce ownership and avoid lock-in to any single provider |
| 2026-04-20 | Student plan timing | Same entitlement as Pro; launch same time if operationally easy | If not, ship immediately after Pro |
| 2026-04-20 | Research wedge strength | Strong wedge, but non-exclusive identity | Position around serious study, reading, and research |
| 2026-04-20 | Team expansion timing | Include lightweight shared lab/notebook features within 12 months | Keep scope explicitly small and non-enterprise |
| 2026-04-20 | Free first-party cloud boundary | No free first-party cloud repos at launch | Free = local-first + bring-your-own sync (GitHub, Google Drive, self-hosted) |
| 2026-04-20 | Account requirement boundary | Accounts required only for cloud/payments | Do not require accounts for local/BYO users |
| 2026-04-20 | Lab scope boundary | Allow narrow shared notebook features only | Invites, notebook permissions, basic shared activity, simple group billing if needed |
| 2026-04-20 | Search + OCR launch scope | Full-content search (notes + PDF text + OCR) and cross-platform OCR both ship at first paid launch | Unlocks "knowledge management" and OCR-backed retrieval as public headlines |
| 2026-04-21 | Semantic search launch scope | Semantic search ships as a Pro feature at paid launch | Previously planned as post-launch; moved forward so retrieval story is complete at launch |
| 2026-04-21 | Patron tier | Ship an optional Patron subscription at $15/month or $144/year above Pro | Patreon-style recurring support; voluntary, visually separate from the Free/Pro/Student grid; perks are ongoing (monthly log, beta, survey), never critical features |
| 2026-04-21 | Billing model | All billing on the web via Stripe, no Apple IAP / Google Play Billing | One subscription travels with the Myelin account across platforms; on mobile, app uses reader-app pattern (no in-app subscribe UI) |

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
