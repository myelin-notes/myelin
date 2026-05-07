---
name: pr-review-resolve
description: >
  Walk through unresolved code review threads on the current PR one at a time:
  verify validity, check reachability in practice, apply a fix or skip with
  reasoning, then pause for approval before moving on. Use when the user says
  "resolve review comments", "/pr-review-resolve", "go through the review",
  or asks to address open PR feedback.
---

Address unresolved review threads on a GitHub PR sequentially. One thread, one fix-or-skip, one pause.

## Process

1. **Identify the PR.** `gh pr view --json number,url,title,headRefName` from the working tree. If the user passed a PR number/URL, use that.

2. **Fetch unresolved threads via GraphQL.** The REST `/pulls/<n>/comments` endpoint does not expose `isResolved` — use:

   ```bash
   gh api graphql -f query='
   {
     repository(owner: "<owner>", name: "<repo>") {
       pullRequest(number: <n>) {
         reviewThreads(first: 100) {
           nodes {
             isResolved
             isOutdated
             path
             comments(first: 10) {
               nodes { databaseId author { login } body path line url }
             }
           }
         }
       }
     }
   }'
   ```

   Filter to `isResolved: false`. Note `isOutdated: true` threads — the line numbers may not match HEAD; cross-check by reading the file before assuming the comment still applies.

3. **List the items up front.** Create one task per unresolved thread (TaskCreate) so the user can see the queue. Mark the active one `in_progress`.

4. **For each thread, in order:**

   a. **Read the code.** Open the file, look at surrounding context, check callers/usages with `grep`. Read enough to understand the reviewer's concern, not just the snippet they quoted.

   b. **Verify validity.** Is the concern real? Is it a runtime bug, a structural smell, a perf cliff, a stale comment, or a misunderstanding? State the answer plainly.

   c. **Check reachability.** Even if technically valid, can it actually fire in practice? "Two peers offline both create a frame" — yes, reachable on multi-device sync. "User passes empty string to internal helper" — usually not. Be honest about which.

   d. **Apply a fix or skip.**
      - **Fix** — make the smallest change that addresses the concern. Run `yarn tsc --noEmit` and any directly relevant tests. Don't expand scope into adjacent cleanup.
      - **Skip** — say why (intentional, not reachable, supersedes by another change, design tradeoff). The reviewer can re-engage if they disagree.
      - **Defer** — if the comment surfaces a larger redesign that doesn't belong in this PR, open a GitHub issue (label appropriately, add to the relevant project) and link it back to the review thread URL. Keep this PR scoped.

   e. **Summarize and pause.** Short summary: what changed (or why nothing did), test status, any tradeoffs. Then **stop and wait for approval** before moving to the next thread. Do not batch.

5. **Commit cadence per user direction.** Default: commit each accepted fix as its own commit (so reverting one is easy and the reviewer can see the response per-thread). If the user says "commit at the end" or batches multiple together, follow that. Reference the review thread URL or comment ID in commit messages when it helps traceability.

## Calibration

- **Match the reviewer's framing.** If they asked "could we cache this?", answering with the cache is on-target. Volunteering a different (larger) refactor is not — surface it as a follow-up issue instead.
- **Don't pile on unrelated changes.** A review-resolution pass is not a "while I'm in this file" pass. Touch only what the thread asks about.
- **One pause per thread, every time.** Even if the next thread looks trivially related, stop after summarizing. The user calibrates the next move.
- **When validity is genuinely unclear**, say so and ask one clarifying question rather than guessing. Better than a fix the user has to revert.

## Boundaries

This skill resolves review threads — it does not approve PRs, mark threads as resolved on GitHub (the reviewer does that), or push to the remote. It does commit fixes locally when the user says to. If a thread reveals a larger problem, prefer "open an issue + skip" over "implement the redesign here".
