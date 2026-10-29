#!/usr/bin/env bash
# Worktree pinning helpers (host-neutral; needs only git and bash).
#
#   wt-guard.sh where [dir]              print root, branch, linked-or-main, and sibling worktrees
#   wt-guard.sh inside <root> <path>...  exit 0 if every path is inside <root>; else list offenders, exit 1
#   wt-guard.sh find <query>             print worktree paths whose path or branch contains <query>
#
# Exit codes: 0 ok, 1 offenders or no match, 3 not a git repo, 64 usage.

set -euo pipefail

# Resolve a path to an absolute, physical path without requiring it to exist.
# Walks component by component from the root: `.` is skipped, `..` pops (physically, after
# symlinked directories were resolved), existing directories and symlinks are resolved, and the
# remaining components of a path that does not exist yet are kept as written. A symlink as the
# last component is followed, so a link to a file outside a root is reported as outside.
abspath() {
  local path="$1" depth="${2:-0}" current="" component target candidate
  [[ "$path" == /* ]] || path="$PWD/$path"
  if [[ "$depth" -gt 20 ]]; then
    echo "$path"
    return
  fi
  local -a parts
  IFS=/ read -r -a parts <<<"$path"
  for component in "${parts[@]}"; do
    case "$component" in
      "" | ".") continue ;;
      "..") current="${current%/*}" ;;
      *)
        candidate="$current/$component"
        if [[ -L "$candidate" ]]; then
          target="$(readlink "$candidate")"
          [[ "$target" == /* ]] || target="$current/$target"
          current="$(abspath "$target" $((depth + 1)))"
          [[ "$current" == "/" ]] && current=""
        elif [[ -d "$candidate" ]]; then
          current="$(cd "$candidate" && pwd -P)"
        else
          current="$candidate"
        fi
        ;;
    esac
  done
  echo "${current:-/}"
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
    # Tab-separated `path<TAB>branch`: worktree paths may contain spaces.
    while IFS=$'\t' read -r wt_path wt_branch; do
      case "$wt_path $wt_branch" in
        *"$query"*)
          echo "$wt_path"
          found=0
          ;;
      esac
    done < <(git worktree list --porcelain | awk '/^worktree /{p=substr($0,10)} /^branch /{b=substr($0,8)} /^$/{if(p)print p "\t" b; p="";b=""} END{if(p)print p "\t" b}')
    exit "$found"
    ;;
  *)
    echo "usage: wt-guard.sh where|inside|find ..." >&2
    exit 64
    ;;
esac
