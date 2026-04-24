#!/usr/bin/env bash
set -euo pipefail

sync_branch="wktree"

fail() {
  echo "error: $*" >&2
  exit 1
}

require_clean_worktree() {
  local path="$1"

  if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
    fail "worktree is not clean: $path"
  fi
}

branch_worktree_path() {
  local branch="$1"

  git worktree list --porcelain | awk -v branch_ref="refs/heads/$branch" '
    $1 == "worktree" {
      path = substr($0, 10)
    }

    $1 == "branch" && $2 == branch_ref {
      print path
      exit
    }
  '
}

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

target_branch="$(git branch --show-current)"
[[ -n "$target_branch" ]] || fail "not currently on a branch"
[[ "$target_branch" != "$sync_branch" ]] || fail "run this from the branch that should receive $sync_branch"

git show-ref --verify --quiet "refs/heads/$sync_branch" || fail "branch not found: $sync_branch"
require_clean_worktree "$repo_root"

sync_path="$(branch_worktree_path "$sync_branch")"
[[ -n "$sync_path" ]] || fail "$sync_branch must be checked out in a git worktree"
require_clean_worktree "$sync_path"

echo "Merging $sync_branch into $target_branch with a merge commit..."
git merge --no-ff "$sync_branch"

echo "Fast-forwarding $sync_branch to $target_branch..."
git -C "$sync_path" merge --ff-only "$target_branch"

echo "Done. $target_branch and $sync_branch now point to $(git rev-parse --short HEAD)."
