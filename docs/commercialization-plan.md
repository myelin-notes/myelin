# Myelin Commercialization Plan

_Last updated: April 20, 2026_

## Executive Summary

Myelin should **not** try to be a general-purpose Notion competitor or an enterprise-first product in the next phase.

The most credible path, given the product thesis and the current codebase, is:

1. Build an **indie-first prosumer business**.
2. Focus the product and messaging on **students, researchers, and other people who genuinely need typed notes + handwriting in the same live document**.
3. Keep the core product generous and local-first.
4. Monetize **managed convenience**, **search/OCR**, and **research workflow polish**, not note ownership.
5. Treat team and enterprise features as optional later expansions, not the thing that funds the product in the near term.

This is the plan most likely to produce:

- a useful side income in the medium term
- a sustainable solo business if the product compounds
- a path to full-time income without forcing Myelin into a high-burn SaaS company

## Bottom-Line Decision

### Strategic choice

Myelin should pursue:

- **Primary wedge:** academic and research-oriented prosumers
- **Business model:** free core + paid personal/prosumer plan
- **Future expansion:** small research labs and technical teams only after strong individual adoption

Myelin should avoid:

- building a horizontal workplace tool for every team
- trying to win on low price alone in B2B
- relying on honor-system commercial licensing as real revenue
- making AI the core monetization story

## Why This Fits Myelin

### What is actually differentiated

Myelin's strongest advantage is not "a cheaper notes app."

It is:

- **live sync across devices**
- **typed structured notes and freehand ink in the same note**
- **local-first architecture that keeps infra costs low**
- **multi-platform distribution through Tauri**

That matters most in workflows where users regularly:

- type and handwrite in the same session
- annotate PDFs or technical documents
- sketch diagrams alongside structured notes
- move between laptop and tablet while staying in one note

That is much more true for:

- students
- grad students
- researchers
- technical readers and writers
- some design and engineering workflows

That is much less true for:

- general business teams
- CRM-heavy operations teams
- sales teams
- marketing teams
- enterprises buying admin/compliance suites

### What the current codebase already supports

The current repo already supports the core shape of the product:

- Tauri multi-platform shell and bundle targets: `src-tauri/tauri.conf.json`
- local-first repositories with optional GitHub-backed sync: `src/lib/sync/repo/config.ts`, `src/lib/sync/repo/factory.ts`, `src/lib/sync/repo/github.ts`, `src/lib/sync/repo/local.ts`
- cached outbox-based remote sync rather than a heavy centralized backend: `src/lib/sync/repo/cached.ts`
- Yjs-backed note sessions and live peer sync: `src/lib/sync/session.ts`, `src/lib/sync/live/iroh.ts`, `src-tauri/src/iroh_transport.rs`
- hybrid canvas model with strokes + structured page frames: `src/pages/canvas/elements/stroke-element.ts`, `src/pages/canvas/elements/page-frame-element.ts`
- Markdown/PDF/image import: `src/pages/canvas/media/index.ts`, `src/pages/canvas/media/markdown.ts`, `src/pages/canvas/media/pdf.ts`

The codebase does **not** yet justify claiming:

- enterprise collaboration
- deep knowledge management search
- polished end-user sync UX
- cross-platform OCR as a shipped product feature
- fully managed cloud sync
- institution-grade administration

Those gaps matter because they should define what gets built next and what should not be promised too early.

## Critical Read on the Other Agent's Analysis

The other agent is directionally right on the most important points:

- general B2B is a weak immediate fit
- honor-system commercial licensing is not serious revenue
- enterprise revenue requires enterprise features
- a vertical wedge is more credible than a horizontal one

Where I disagree or would tighten the conclusion:

- **"Managed cloud at $2/mo" is the wrong price point.** It is too cheap to matter and trains users to undervalue the product.
- **The goal should not be "B2B or bust."** Since you are willing to stay indie, a strong prosumer business is a valid outcome.
- **Students alone are too low-ARPU, but students + researchers + technical prosumers is viable.**
- **You do not need to choose between cheap/free plans and real revenue.** You need free ownership and paid convenience.

The right plan is therefore not:

- pure consumer student app
- pure enterprise SaaS

It is:

- an indie prosumer product with a research/student wedge and a later small-team option

## Positioning

### Product statement

Myelin is the note app where **structured documents and handwriting stay in the same live note across devices**.

### Positioning to emphasize

- Write lecture notes on laptop and annotate them immediately on tablet.
- Read papers or PDFs and keep typed notes, highlights, and sketches in one note.
- Build technical notes that combine prose, formulas, diagrams, and markup without splitting across tools.

### Positioning to avoid

- "Notion replacement"
- "Obsidian replacement" as the lead message
- "team collaboration platform"
- "cheaper enterprise tool"

Those messages invite comparison against product surfaces Myelin does not need to win right now.

## Recommended Business Model

### Principle

Keep **ownership and core note-taking free**.

Charge for:

- removing setup friction
- reducing sync anxiety
- improving search and OCR
- making research workflows smoother
- saving time for serious users

### Packaging

| Plan | Audience | Price | Purpose |
| --- | --- | --- | --- |
| Free | Everyone | Free | Adoption, habit, trust |
| Pro | Serious students, researchers, prosumers | $8/month or $72/year | Primary revenue |
| Student/Educator Pro | Price-sensitive academic users | $4/month or $36/year | Accessibility without destroying ARPU |
| Lab | Small research groups, later | $12/user/month or $120/user/year | Optional expansion, not required for viability |

### Free plan

Free should include:

- unlimited local notes
- the hybrid canvas/document editor
- handwritten ink and typed content in the same note
- PDF, image, and Markdown import/export
- local search over titles, tags, and indexed local content once search ships
- BYO sync path such as GitHub-backed sync
- local-first offline use

Free should **not** be crippled by artificial note limits.

The free plan should make users believe:

- the product is real
- their notes are theirs
- they can adopt Myelin without risk

### Pro plan

Pro should be the main plan that funds the product.

Pro should include:

- managed Myelin Cloud sync and backup
- zero-setup multi-device onboarding
- version history and restore
- cross-platform OCR-backed search
- faster indexing and background processing
- advanced PDF and research workflows
- priority support
- early access/beta channel

This plan is not "more notes."

It is "Myelin removes setup, backup, sync, and retrieval friction for people who use it seriously."

### Student/Educator Pro

This plan exists because accessibility matters and students are a natural wedge.

It should be:

- genuinely cheap
- annual-first
- verified if needed later, but not overcomplicated at launch

The purpose is not maximizing revenue per user.

The purpose is maximizing adoption in the segment most likely to love and evangelize the product.

### Lab plan

This should come only after individual product-market fit.

It can include:

- shared spaces or shared notebooks
- collaborator permissions
- activity history
- centralized billing
- simple admin controls

This is a nice later expansion, but **it should not be the near-term funding assumption**.

## What Must Be Built To Make This Sellable

### 1. Managed cloud repository

Add a first-party `cloud` repository type to the existing repository abstraction.

Why:

- the repository layer already supports multiple backends cleanly
- the local cache + outbox model should be preserved
- this is the most direct way to add paid convenience without rewriting the app around a central document server

Implementation needs:

- account identity
- authentication
- note blob storage
- manifest metadata storage
- outbox sync target
- restore/version snapshot model
- storage accounting

### 2. Production-grade sync UX

The underlying sync story is promising, but a paid product needs polished UX around it.

Build:

- device pairing flow
- sync status that normal users can understand
- conflict recovery UX
- restore from history
- offline and reconnect states
- troubleshooting and diagnostics

Today the explicit peer sync UI is still debug-only, which is a strong signal that this area is not yet production-ready enough to sell as a headline feature.

### 3. Full-content search

Myelin cannot credibly claim "knowledge management" until search goes beyond file name and tags.

Build:

- full-text indexing for structured note content
- PDF text extraction indexing
- OCR text indexing
- local-first search index
- ranking that prioritizes exact matches and title hits

This is a retention feature, not just a checkbox.

Serious users stay when retrieval is good.

### 4. OCR as a real product feature

OCR exists natively on Apple platforms in the codebase, but it needs to become a coherent product feature.

Build:

- cross-platform OCR pipeline
- UX to extract, index, and search OCR results
- settings for automatic and manual OCR
- background processing status
- failure recovery

Do not sell OCR as a premium feature until it is reliable and visible to users.

### 5. Research workflow features

This is where the wedge becomes stronger than "just a notes app."

Build:

- PDF annotation polish
- note + source split views
- source-linked highlights and excerpts
- citation support
- Zotero integration
- LaTeX or good math support
- better technical diagram workflow

These are features that make Myelin more valuable to the users who actually need the hybrid canvas.

### 6. Billing and entitlement layer

You need a real payment and entitlement system, even as an indie product.

Build:

- account-to-plan entitlements
- annual and monthly subscriptions
- trial support
- restore purchases
- plan-aware feature gating
- cancellation and grace periods

Platform note:

- desktop/web can use direct billing
- iOS and Android builds need platform-aware billing flows and policy compliance where required

Official references:

- [Apple in-app purchase overview](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines)
- [Google Play Billing](https://developer.android.com/distribute/play-billing)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en)

## What Should Not Be Built Yet

Do **not** spend the next cycle building:

- enterprise SSO
- SOC 2 prep
- admin console for large orgs
- Slack/Jira/Drive integrations
- Notion-style databases and relations
- large-team whiteboard facilitation features

Those things are expensive, slow, and orthogonal to the part of the product that is actually unique.

## Roadmap

### Phase 1: Foundation for paid personal plans

Goal:

- make Myelin trustworthy enough to pay for as an individual

Build:

- managed cloud repository
- account system
- billing and entitlements
- production sync UX
- version history
- search foundation
- cross-platform OCR path

Ship criteria:

- a user can sign in, connect two devices, edit notes confidently, and recover from mistakes

### Phase 2: Paid beta launch

Goal:

- validate that people will pay for managed convenience

Launch:

- Free
- Pro
- Student/Educator Pro

Measure:

- activation to second-device connection
- trial to paid conversion
- 8-week retention
- support load

### Phase 3: Academic/research differentiation

Goal:

- make Myelin obviously better for research and advanced study workflows

Build:

- Zotero integration
- citations
- stronger PDF workflows
- technical writing polish
- better math support
- source-linked annotations

This is the phase that turns "interesting note app" into "my main academic workspace."

### Phase 4: Optional small-group expansion

Goal:

- expand revenue without becoming an enterprise company

Build:

- shared notebooks
- lightweight permissions
- lab billing
- collaborator history

Do this only if:

- individual retention is strong
- support burden is manageable
- users ask for this often enough to justify the complexity

## Revenue Targets

These are rough targets for an indie business, not venture-style projections.

### Good side income

Examples:

- 250 Pro-equivalent users at $6 effective monthly revenue = about $1,500 MRR
- 500 Pro-equivalent users at $6 effective monthly revenue = about $3,000 MRR

This is enough to prove the business is real and worth continuing.

### Sustainable side business

Examples:

- 1,000 Pro-equivalent users at $6 effective monthly revenue = about $6,000 MRR
- 700 Pro-equivalent users at $8 effective monthly revenue = about $5,600 MRR

This is meaningful, durable side income if churn is under control.

### Plausible sole-income threshold

Examples:

- 1,500 Pro-equivalent users at $7 effective monthly revenue = about $10,500 MRR
- 2,000 Pro-equivalent users at $6 effective monthly revenue = about $12,000 MRR
- 1,000 Pro users at $6 effective monthly revenue plus 50 Lab seats at $12 = about $6,600 MRR
- 1,500 Pro users at $6 effective monthly revenue plus 100 Lab seats at $12 = about $10,200 MRR

The main takeaway:

- Myelin does not need enterprise scale to become a real solo income
- it does need either a meaningful paid personal base or a smaller paid base plus a little team revenue

## Key Metrics

Track these from the start:

- percentage of users who connect a second device
- weekly retention after second-device activation
- trial to paid conversion
- annual plan mix
- paid churn
- search usage
- OCR indexing success rate
- version restore usage
- support tickets per 100 paid users

These metrics matter more than vanity numbers like total signups.

## Risks

### Risk: too broad a message

Mitigation:

- lead with one clear use case family: study, reading, research, technical note-taking

### Risk: free users love it but do not pay

Mitigation:

- charge for convenience, backup, retrieval, and time-saving workflows
- make paid value obvious without punishing ownership

### Risk: cloud sync becomes expensive

Mitigation:

- preserve local-first architecture
- store compact note state efficiently
- meter or limit high-cost workloads like OCR/storage if necessary

### Risk: GitHub BYO sync reduces paid conversion

Mitigation:

- keep it free anyway
- accept that BYO sync is part of the trust story
- win on frictionless onboarding and better recovery, not lock-in

## Immediate Next Actions

If you want to execute this plan without getting lost, the next concrete actions should be:

1. Decide the paid-plan boundary in product terms.
2. Add a `cloud` repository type to the sync architecture.
3. Ship production sync UX before broad monetization.
4. Build full-content search and OCR indexing before leaning hard on "knowledge management" messaging.
5. Prioritize academic/research differentiators over team-admin infrastructure.

### Suggested execution order

#### Step 1: Product boundary

Write a one-page product decision doc that locks:

- what stays free forever
- what is Pro-only
- whether Student/Educator Pro launches at the same time as Pro or one release later

#### Step 2: Architecture boundary

Design the cloud repository backend around the existing repository abstraction, not around a separate app-specific sync model.

That means preserving:

- local-first writes
- outbox-based remote sync
- note ownership semantics

#### Step 3: Conversion boundary

Define the exact user journey you want to monetize:

- user installs Myelin
- user creates a note
- user connects a second device or wants backup/search
- user sees the value of managed sync and retrieval
- user upgrades

If that funnel is not crisp, the pricing page will not save it.

#### Step 4: Wedge boundary

Pick one launch audience for messaging and onboarding.

Recommended:

- students doing serious study
- graduate researchers
- technical readers/writers

Not recommended:

- "everyone who takes notes"
- generic business teams

#### Step 5: Launch boundary

Do not wait for every future idea.

The first paid launch only needs:

- working managed sync
- account + billing
- restore/version history
- search that feels substantially better than title/tag search
- a clear free vs paid distinction users consider fair

## Things To Be Explicit About Publicly

Myelin should publicly promise:

- your notes remain yours
- local-first is a core principle
- BYO sync will remain available
- the free plan will stay genuinely useful

Myelin should not publicly promise:

- enterprise compliance timelines
- full workplace collaboration suite ambitions
- AI-first roadmaps
- becoming a universal team operating system

## Final Recommendation

The best commercialization plan for Myelin is:

- **Indie-first**
- **academic/research and advanced student wedge**
- **free core**
- **paid Pro for managed sync, OCR/search, and research workflow polish**
- **optional small-team/lab expansion later**

This plan is aligned with:

- the current architecture
- your low-infra philosophy
- your willingness to stay indie
- your desire for side income that could eventually become sole income

It is not the fastest path to a large company.

It is the most honest and achievable path to a durable solo business.

## Appendix: External Market Notes

These official competitor pages are useful for pricing calibration:

- [Notion Pricing](https://www.notion.com/pricing)
- [Notion for Education](https://www.notion.com/product/notion-for-education)
- [Obsidian Pricing](https://obsidian.md/pricing.html)
- [Goodnotes Pricing](https://www.goodnotes.com/pricing)

Use them for calibration, not imitation.
