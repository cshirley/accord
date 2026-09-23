#!/usr/bin/env bash
# Pi workflow without ACCORD harness: git tools, subagent, skills, review agents.
# Does not install pi-accord, accord CLI shim, or full install:assets (providers, phase agents).
#
# Usage:
#   scripts/install-pi-skills.sh
#   scripts/install-pi-skills.sh --integrations   # + pi-integrations (crq-notify)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTEGRATIONS=false

for arg in "$@"; do
  case "$arg" in
    --integrations) INTEGRATIONS=true ;;
    -h | --help)
      echo "Usage: scripts/install-pi-skills.sh [--integrations]"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' not found in PATH" >&2
    exit 1
  fi
}

need_cmd pi
need_cmd bun

install_pkg() {
  local dir="$1"
  if [[ ! -f "$dir/package.json" ]]; then
    echo "error: no package.json in $dir" >&2
    exit 1
  fi
  echo "pi install $dir"
  pi install "$dir"
}

install_pkg "$ROOT/packages/pi-subagent"
install_pkg "$ROOT/packages/pi-git"
install_pkg "$ROOT/packages/pi-skills"

if [[ "$INTEGRATIONS" == true ]]; then
  install_pkg "$ROOT/packages/pi-integrations"
fi

echo "Linking standalone review agents into ~/.config/pi/agent/agents/accord ..."
bun "$ROOT/packages/pi-skills/scripts/install-review-agents.ts" --force

echo ""
echo "Done. Skills: commit, pr, review, verify, worktree, ci-debug, session-retro"
if [[ "$INTEGRATIONS" == true ]]; then
  echo "  + crq-notify (integrations)"
fi
echo "No /dev harness — use skills and pi-git tools only."
echo "Restart Pi if it is already running."
