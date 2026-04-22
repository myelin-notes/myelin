# Myelin Implementation Roadmap

This order follows `docs/commercialization-plan.md` and `docs/product-boundary.md`:

- keep the free core trustworthy and useful
- make paid launch about managed sync, restore, search, and OCR
- add research differentiation after paid validation
- leave lab/team expansion until individual traction is real

1. Finish the core free note experience
- Lock the default Document flow: single page frame, clean typing, easy ink-on-top, and safe offline use.
- Finish the advanced canvas behavior: multi-frame focus, scrolling, resizing, layouts, and note previews.
- Keep local-only and bring-your-own sync usage account-free.

2. Ship internal note links as a first-class primitive
- Add `[[note links]]`, backlinks, hover preview, and note embed cards.
- Store links by stable note ID so renames do not break references.
- Make linking work inside page frames and from canvas elements.

3. Ship a command palette and keyboard-first navigation
- Add a global command palette for open note, create note, import, search, insert link, and switch view.
- Fill in core keyboard shortcuts before adding more feature surface.
- Use this to keep the UI simple while the product gets more powerful.

4. Build importers that reduce switching cost
- Ship Obsidian vault import first: folders, Markdown, wiki links, embeds, tags, and attachments.
- Add Notion import next through exported Markdown/HTML, not live API sync.
- Treat Goodnotes import as a later experiment: start with PDF/notebook package import, not full editing parity.

5. Build Myelin Cloud on top of the current sync architecture
- Add a `cloud` repository type, account identity, auth, blob storage, manifest storage, and storage accounting.
- Preserve the existing local-first cache/outbox model instead of introducing a separate central document server.
- Require Myelin accounts only for cloud, billing, and entitlements.

6. Ship production-grade sync UX and version history
- Add device pairing, understandable sync state, offline/reconnect handling, conflict recovery, and diagnostics.
- Add persistent version history and restore flows as the main paid safety feature.
- Make second-device setup feel polished enough to sell.

7. Ship real retrieval before leaning harder into "knowledge management"
- Index note text, PDF text, and OCR text locally.
- Add snippets, filters, ranking, and exact-match-first search behavior.
- Add semantic search on top of that foundation before the paid beta launch.

8. Turn OCR into a visible, reliable product feature
- Build a cross-platform OCR pipeline with background jobs, retries, and clear failure states.
- Show when OCR ran, what text was extracted, and why a search hit matched.
- Keep OCR framed as part of retrieval, not as a separate headline feature.

9. Ship billing, entitlements, and the paid beta
- Implement Stripe-backed Pro, Student/Educator Pro, and Patron entitlements with monthly and annual plans.
- Add trials, grace periods, restore purchases, and clear feature gating.
- Validate second-device activation, trial conversion, retention, churn, and support load before widening scope.

10. Build the research workflow features that justify Pro long-term
- Add note + source split views, source-linked highlights/excerpts, and stronger PDF annotation polish.
- Add citations, bibliography insertion, and Zotero integration.
- Add reliable LaTeX/math support for technical writing and study notes.

11. Add diagramming that fits the research wedge
- Start with flowchart/diagram blocks such as Mermaid-style authoring inside page frames.
- Let diagrams also live on the canvas with connectors when needed.
- Prioritize technical diagrams over generic team whiteboarding features.

12. Ship the graph view after links and search are real
- Build the graph from note links, backlinks, tags, and eventually citations.
- Start with useful navigation and filtering, not a decorative full-screen graph.
- Make the graph help users recover context around a note, paper, or topic.

13. Add documentation-management polish
- Add templates for lecture notes, paper reviews, lab notebooks, meeting notes, and study sheets.
- Add note metadata, outlines/table of contents, and saved searches/views without turning Myelin into a database product.
- Consider read-only publish/share only after sync, history, and search are stable.

14. Add MCP access for AI agents after retrieval is stable
- Expose read/query APIs for notes, links, tags, search results, OCR text, and citations.
- Start read-only so agents can query the knowledge base safely.
- Add write actions only after audit trails and restore flows are solid.

15. Explore lightweight lab features last
- Add shared notebooks, notebook-level permissions, collaborator history, and simple lab billing.
- Keep comments, mentions, admin consoles, SSO, and enterprise compliance out of scope.
- Do this only if individual retention is strong and users ask for it repeatedly.
