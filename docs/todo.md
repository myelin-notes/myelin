# Myelin Todo

1. Lock the launch boundaries
- Keep free forever: unlimited local notes, local-first editing, import/export, offline use, and bring-your-own sync.
- Keep paid launch scope narrow: Myelin Cloud sync, accounts, billing, version history, full-content search, and OCR-backed retrieval.
- Resolve the remaining launch decisions: Pro workflow extras, a 14-day cloud trial, and whether publish/share stays post-launch.

2. Lock the audience and messaging
- Position Myelin for serious study, reading, and research.
- Lead with the core promise: typed notes and handwriting in the same live note across devices.
- Avoid generic team, enterprise, and AI-first messaging.

3. Finalize the note model UX
- Keep one note model: a canvas with page frames.
- Make the default experience a single centered page frame, with Document and Board as view presets.
- Define multi-frame behavior clearly: focus, scrolling, resizing/layouts, and note previews.

4. Build Myelin Cloud on the existing sync architecture
- Add a `cloud` repository type without breaking the local-first, outbox-based sync model.
- Implement auth, storage, metadata, snapshots/version history, and storage accounting.
- Require Myelin accounts only for cloud features and billing.

5. Ship production-grade sync UX
- Add device pairing and second-device onboarding.
- Show sync status, offline/reconnect states, and useful diagnostics.
- Build conflict recovery and restore flows normal users can understand.

6. Ship real search and retrieval
- Index note text, PDF text, and OCR text locally.
- Improve ranking, filters, and result snippets so retrieval is clearly better than title/tag search.
- Add semantic search only after the standard search foundation is solid.

7. Turn OCR into a real product feature
- Build a cross-platform OCR pipeline.
- Show when OCR ran, what text was extracted, and what failed.
- Tie OCR directly into search instead of marketing it as a standalone feature.

8. Launch paid plans and entitlements
- Implement Stripe-backed entitlements, monthly/annual billing, restore purchases, and grace periods.
- Launch Free, Pro, and Student/Educator Pro together if operationally simple.
- Add Patron as a separate supporter option, not as a core plan tier.

9. Run a focused paid beta
- Validate that users will pay for managed sync, restore, search, and OCR.
- Track second-device activation, trial-to-paid conversion, 8-week retention, paid churn, and support load.
- Do not add a free first-party cloud tier during this phase.

10. Add research workflow differentiation after paid validation
- Polish PDF annotation, split-view reading/writing, and source-linked highlights/excerpts.
- Add citations, Zotero integration, math support, and better technical diagram workflows.
- Keep AI optional and secondary to retrieval and note-taking.

11. Explore small-group features only after individual traction
- Add shared notebooks, lightweight permissions, collaborator history, and simple lab billing.
- Keep the scope small and avoid comments/mentions, admin consoles, SSO, and compliance work.
- Skip this until individual retention and support burden look healthy.
