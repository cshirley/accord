#!/usr/bin/env bash
# Record and check "last green verify" for the current git worktree.
#
#   green.sh mark  [kind]   fingerprint the working tree and store it
#   green.sh check [kind]   exit 0 if the working tree matches the stored fingerprint
#   green.sh show  [kind]   print the stored record
#
# kind: `verify` (default; last green verification run) or `review` (last completed review).
#
# Fingerprint = tree hash of HEAD + all tracked/untracked, non-ignored files (temp index;
# the real index and working tree are not touched). Per-worktree marker lives under
# `git rev-parse --git-path accord/last-<green|review>`.
# Exit codes (check): 0 green, 1 stale (edits since last green), 2 no record.

set -euo pipefail

fingerprint() {
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/green-index.XXXXXX")"
  trap 'rm -f "$tmp"' RETURN
  GIT_INDEX_FILE="$tmp" git read-tree HEAD 2>/dev/null || GIT_INDEX_FILE="$tmp" git read-tree --empty
  GIT_INDEX_FILE="$tmp" git add -A >/dev/null 2>&1
  GIT_INDEX_FILE="$tmp" git write-tree
}

git rev-parse --show-toplevel >/dev/null 2>&1 || {
  echo "green.sh: not inside a git repository" >&2
  exit 3
}

cmd="${1:-check}"
kind="${2:-verify}"
case "$kind" in
  verify) marker="$(git rev-parse --git-path accord/last-green)" ;;
  review) marker="$(git rev-parse --git-path accord/last-review)" ;;
  *)
    echo "green.sh: unknown kind '$kind' (verify|review)" >&2
    exit 64
    ;;
esac

case "$cmd" in
  mark)
    mkdir -p "$(dirname "$marker")"
    fp="$(fingerprint)"
    head_sha="$(git rev-parse --verify -q HEAD || echo none)"
    printf 'tree=%s\nhead=%s\nat=%s\n' "$fp" "$head_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker"
    echo "$kind: marked tree=$fp head=$head_sha"
    ;;
  check)
    if [[ ! -f "$marker" ]]; then
      echo "stale: no $kind recorded — run $kind, then 'green.sh mark $kind'" >&2
      exit 2
    fi
    recorded="$(sed -n 's/^tree=//p' "$marker")"
    current="$(fingerprint)"
    if [[ "$recorded" == "$current" ]]; then
      echo "ok: working tree matches last $kind state ($(sed -n 's/^at=//p' "$marker"))"
    else
      echo "stale: edits since last $kind — run $kind again" >&2
      exit 1
    fi
    ;;
  show)
    [[ -f "$marker" ]] && cat "$marker" || { echo "no record" >&2; exit 2; }
    ;;
  *)
    echo "usage: green.sh mark|check|show [verify|review]" >&2
    exit 64
    ;;
esac
