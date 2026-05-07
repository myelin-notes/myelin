---
name: pr-review
description: >
  Post inline code review comments on the current PR via the GitHub CLI, matching
  the style of comments already on the PR. Use when the user says "review this
  PR", "/pr-review", "leave review comments", or asks for inline feedback on a
  GitHub PR. Focuses on substantive findings (correctness, perf, silent failures)
  over nits, and avoids piling onto files an existing reviewer has already flagged.
---

Post a GitHub review on the current PR with inline comments. Match the existing reviewer's voice — don't impose a house style.

## Process

1. **Identify the PR.** `gh pr view --json number,title,headRefName,baseRefName` from the working tree. If the user passed a PR number/URL, use that instead.

2. **Read existing comments first.** `gh api repos/<owner>/<repo>/pulls/<n>/comments` — capture tone, length, casing, hedging level. The author has already calibrated to a reviewer; a new voice in the same review reads as noise.

3. **Read the diff.** `gh pr diff <n>`. If output is large, it gets persisted to a file — read that. Capture the head commit SHA from the existing comments' `commit_id` (or `gh pr view --json commits`); inline comments need it.

4. **Read surrounding code for any file you'll comment on.** Line numbers in the diff are relative to the new file post-patch — the API expects new-file line numbers with `side: "RIGHT"`. Confirm by opening the file rather than counting hunk lines.

5. **Pick findings worth writing.** Bias toward:
   - Correctness bugs and silent failures (toast vs `logger.debug` for user-facing misses)
   - Perf cliffs that fire on hot paths (per-keystroke I/O, per-frame allocation)
   - Concurrency/uniqueness assumptions that the data model doesn't enforce
   - Imports / module structure smells a linter would catch but didn't

   Skip:
   - Files an existing reviewer has already flagged with a broad question ("can this be combined with X?") — don't pile on; one or two adjacent comments only if they raise a *different* concern
   - Pure style preferences when no convention exists in the repo
   - "Consider extracting" with no concrete extraction in mind

6. **Write each comment with location + concrete fix or question.** Match the existing reviewer's register. If they write lowercase casual questions, do the same. Keep comments short — 1–3 sentences. Backtick exact symbols.

7. **Post as one review, not N drive-by comments.** Use the reviews API with `event: "COMMENT"` (don't `APPROVE` or `REQUEST_CHANGES` unless the user asked):

```bash
cat <<'EOF' | gh api -X POST /repos/<owner>/<repo>/pulls/<n>/reviews --input -
{
  "commit_id": "<head-sha>",
  "event": "COMMENT",
  "body": "",
  "comments": [
    { "path": "<file>", "line": <new-file-line>, "side": "RIGHT", "body": "<comment>" }
  ]
}
EOF
```

   For multi-line comments use `start_line` + `start_side` alongside `line` + `side`. The endpoint returns the review URL — share it.

## Calibration

- The user already has a few comments on the PR? **Read them, match them, fewer of them.** If the existing reviewer left 2 comments, 6 from you is a wall.
- The user has zero comments and asked for a full review? Then go broader and use a top-level `body` summary.
- Never approve or request-changes on the user's behalf — `event: "COMMENT"` only, unless explicitly told otherwise.

## Boundaries

Posts review comments only. Does not write the fix, does not push commits, does not merge. If the user wants the fixes implemented, that's a separate follow-up.
