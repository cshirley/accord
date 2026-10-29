#!/usr/bin/env bash
# Worktree pinning helpers (host-neutral; needs only git and bash).
#
#   wt-guard.sh where [dir]              print root, branch, linked-or-main, and sibling worktrees
#   wt-guard.sh inside <root> <path>...  exit 0 if every path is inside <root>; else list offenders, exit 1
#   wt-guard.sh find <query>             print worktree paths whose path or branch contains <query>
#
# Exit codes: 0 ok, 1 offenders or no match, 3 not a git repo, 64 usage.

set -euo pipefail

abspath() {
  local target="$1"
  if [[ -d "$target" ]]; then
    (cd "$target" && pwd -P)
  else
    local dir base
    dir="$(dirname "$target")"
    base="$(basename "$target")"
    # walk up to the nearest existing ancestor so paths of files not yet created resolve
    while [[ ! -d "$dir" && "$dir" != "/" && "$dir" != "." ]]; do
      base="$(basename "$dir")/$base"
      dir="$(dirname "$dir")"
    done
    echo "$(cd "$dir" && pwd -P)/$base"
  fi
}

cmd="${1:-}"
shift || true

case "$cmd" in
  where)
    dir="${1:-.}"
    cd "$dir"
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
      echo "wt-guard: not inside a git repository" >&2
      exit 3
    }
    branch="$(git symbolic-ref --short -q HEAD || echo "(detached)")"
    gitdir="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
    common="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
    if [[ "$gitdir" == "$common" ]]; then kind="main-checkout"; else kind="linked-worktree"; fi
    echo "root=$root"
    echo "branch=$branch"
    echo "kind=$kind"
    echo "worktrees:"
    git worktree list --porcelain | awk '
      /^worktree /{p=substr($0,10)} /^branch /{b=substr($0,8)} /^$/{if(p){print "  " p " " b}; p="";b=""} END{if(p)print "  " p " " b}'
    ;;
  inside)
    [[ $# -ge 2 ]] || { echo "usage: wt-guard.sh inside <root> <path>..." >&2; exit 64; }
    root="$(abspath "$1")"
    shift
    bad=0
    for path in "$@"; do
      resolved="$(abspath "$path")"
      case "$resolved/" in
        "$root"/*) ;;
        *) echo "outside: $resolved (root $root)" >&2; bad=1 ;;
      esac
    done
    exit "$bad"
    ;;
  find)
    query="${1:-}"
    [[ -n "$query" ]] || { echo "usage: wt-guard.sh find <query>" >&2; exit 64; }
    git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "wt-guard: not inside a git repository" >&2; exit 3; }
    found=1
    while read -r line; do
      case "$line" in *"$query"*) echo "${line%% *}"; found=0 ;; esac
    done < <(git worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch /{b=substr($0,8)} /^$/{if(p)print p " " b; p="";b=""} END{if(p)print p " " b}')
    exit "$found"
    ;;
  *)
    echo "usage: wt-guard.sh where|inside|find ..." >&2
    exit 64
    ;;
esac
