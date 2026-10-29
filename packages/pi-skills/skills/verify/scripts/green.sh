#!/usr/bin/env bash
# Record and check "last green verify" and "last review" for the current git worktree.
#
#   green.sh mark  [kind] [--tree FP] [--source local|branch] [--critical N] [--accepted REASON]
#   green.sh check [kind]
#   green.sh show  [kind]
#   green.sh fingerprint
#
# kind: `verify` (default; last green verification run) or `review` (last completed review).
#
# Fingerprint = tree hash of the working tree: HEAD plus all tracked and untracked, non-ignored
# files. It is computed with a temporary index (built from HEAD, so every file is re-hashed) and a
# temporary object directory, so the real index, the working tree and `.git/objects` are not touched.
# The marker lives per worktree under `git rev-parse --git-path accord/last-<green|review>`.
#
# Review marks also record `source` (what the review covered), `critical` (open Critical
# findings) and `accepted` (the reason a user accepted them). `check review` fails when:
#   - critical > 0 and no `accepted` reason is recorded;
#   - source=local and the branch has commits ahead of origin/HEAD (they were not reviewed).
#
# Use `fingerprint` at diff-capture time and pass it as `mark review --tree FP` when the review
# ends: edits made while reviewers ran then make the mark stale instead of being attested.
#
# Exit codes: 0 ok, 1 stale or review not satisfied, 2 no record, 3 not a git repo,
#             4 fingerprint failed, 64 usage.

set -euo pipefail

fingerprint() {
  local work index objects real_objects status=0 tree
  work="$(mktemp -d "${TMPDIR:-/tmp}/green.XXXXXX")" || return 4
  index="$work/index"
  objects="$work/objects"
  mkdir -p "$objects"
  real_objects="$(cd "$(git rev-parse --git-path objects)" && pwd -P)" || {
    rm -rf "$work"
    return 4
  }

  (
    export GIT_INDEX_FILE="$index" GIT_OBJECT_DIRECTORY="$objects" \
      GIT_ALTERNATE_OBJECT_DIRECTORIES="$real_objects"
    # Start from HEAD, not a copy of the real index: a copied index carries stat data, and a
    # same-size edit within the same timestamp tick would then be missed (racy git). Hashing
    # every file is slower but always correct, which matters for a gate.
    if git rev-parse --verify -q HEAD >/dev/null; then
      git read-tree HEAD
    else
      git read-tree --empty
    fi
    git add -A
    git write-tree
  ) 2>"$work/err" >"$work/tree" || status=$?

  # git only warns (exit 0) about an unreadable directory, then omits its files: treat that as a
  # failure too, otherwise the fingerprint silently ignores part of the tree.
  if [[ $status -eq 0 ]] && grep -qiE 'permission denied|could not open directory' "$work/err"; then
    status=1
  fi

  if [[ $status -ne 0 ]]; then
    echo "green.sh: fingerprint failed (git exit $status): $(head -c 300 "$work/err")" >&2
    rm -rf "$work"
    return 4
  fi
  tree="$(cat "$work/tree")"
  rm -rf "$work"
  if [[ -z "$tree" ]]; then
    echo "green.sh: fingerprint failed (empty tree hash)" >&2
    return 4
  fi
  echo "$tree"
}

git rev-parse --show-toplevel >/dev/null 2>&1 || {
  echo "green.sh: not inside a git repository" >&2
  exit 3
}

cmd="${1:-check}"
shift || true

if [[ "$cmd" == "fingerprint" ]]; then
  fingerprint
  exit $?
fi

kind="verify"
if [[ $# -gt 0 && "$1" != --* ]]; then
  kind="$1"
  shift
fi

tree_override=""
source_kind=""
critical=""
accepted=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tree) tree_override="${2:?--tree needs a value}"; shift 2 ;;
    --source) source_kind="${2:?--source needs local or branch}"; shift 2 ;;
    --critical) critical="${2:?--critical needs a number}"; shift 2 ;;
    --accepted) accepted="${2:?--accepted needs a reason}"; shift 2 ;;
    *)
      echo "green.sh: unknown option '$1'" >&2
      exit 64
      ;;
  esac
done

case "$kind" in
  verify) marker="$(git rev-parse --git-path accord/last-green)" ;;
  review) marker="$(git rev-parse --git-path accord/last-review)" ;;
  *)
    echo "green.sh: unknown kind '$kind' (verify|review)" >&2
    exit 64
    ;;
esac

if [[ -n "$source_kind" && "$source_kind" != "local" && "$source_kind" != "branch" ]]; then
  echo "green.sh: --source must be local or branch" >&2
  exit 64
fi
if [[ -n "$critical" && ! "$critical" =~ ^[0-9]+$ ]]; then
  echo "green.sh: --critical must be a number" >&2
  exit 64
fi
if [[ -n "$tree_override" && ! "$tree_override" =~ ^[0-9a-f]{40,64}$ ]]; then
  echo "green.sh: --tree must be a tree hash from 'green.sh fingerprint'" >&2
  exit 64
fi
if [[ "$kind" != "review" && ( -n "$source_kind" || -n "$critical" || -n "$accepted" ) ]]; then
  echo "green.sh: --source/--critical/--accepted apply to the review kind only" >&2
  exit 64
fi

field() { sed -n "s/^$1=//p" "$marker" | head -n 1; }

case "$cmd" in
  mark)
    mkdir -p "$(dirname "$marker")"
    fp="${tree_override:-$(fingerprint)}"
    head_sha="$(git rev-parse --verify -q HEAD || echo none)"
    {
      printf 'tree=%s\nhead=%s\nat=%s\n' "$fp" "$head_sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      [[ -n "$source_kind" ]] && printf 'source=%s\n' "$source_kind"
      [[ -n "$critical" ]] && printf 'critical=%s\n' "$critical"
      [[ -n "$accepted" ]] && printf 'accepted=%s\n' "${accepted//$'\n'/ }"
    } >"$marker"
    echo "$kind: marked tree=$fp head=$head_sha"
    ;;
  check)
    if [[ ! -f "$marker" ]]; then
      echo "stale: no $kind recorded — run $kind, then 'green.sh mark $kind'" >&2
      exit 2
    fi
    recorded="$(field tree)"
    current="$(fingerprint)"
    if [[ "$recorded" != "$current" ]]; then
      echo "stale: edits since last $kind — run $kind again" >&2
      exit 1
    fi
    if [[ "$kind" == "review" ]]; then
      open_critical="$(field critical)"
      if [[ -n "$open_critical" && "$open_critical" -gt 0 && -z "$(field accepted)" ]]; then
        echo "blocked: last review left $open_critical open Critical finding(s); fix them and re-review, or record 'mark review --accepted <reason>'" >&2
        exit 1
      fi
      if [[ "$(field source)" == "local" ]] && git rev-parse --verify -q origin/HEAD >/dev/null; then
        ahead="$(git rev-list --count origin/HEAD..HEAD 2>/dev/null || echo 0)"
        if [[ "$ahead" -gt 0 ]]; then
          echo "blocked: review covered only uncommitted changes; $ahead commit(s) ahead of origin/HEAD were not reviewed — re-run the review with source=branch" >&2
          exit 1
        fi
      fi
    fi
    echo "ok: working tree matches last $kind state ($(field at))"
    ;;
  show)
    [[ -f "$marker" ]] && cat "$marker" || { echo "no record" >&2; exit 2; }
    ;;
  *)
    echo "usage: green.sh mark|check|show [verify|review] | fingerprint" >&2
    exit 64
    ;;
esac
