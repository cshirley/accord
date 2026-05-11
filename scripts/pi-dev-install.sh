#!/usr/bin/env bash
# Register this repo with Pi (`pi install`) so `package.json` → `pi` loads the
# bundled extension modules (pi-subagent, pi-worktree, …) plus the ACCORD harness,
# then link bundled skills/agents/providers (`bun run install:pi-assets`).
#
# Usage:
#   scripts/pi-dev-install.sh
#   scripts/pi-dev-install.sh /path/to/other-pi-package [/path/to/another ...]
#
# Extra arguments are additional Pi package roots installed before this repo
# (each must contain a package.json). This repo is always installed last.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: '$1' not found in PATH" >&2
    exit 1
  fi
}

need_cmd pi
need_cmd bun

for d in "$@"; do
  if [[ ! -d "$d" ]]; then
    echo "error: not a directory: $d" >&2
    exit 1
  fi
  if [[ ! -f "$(cd "$d" && pwd)/package.json" ]]; then
    echo "error: no package.json in: $d" >&2
    exit 1
  fi
  echo "pi install $(cd "$d" && pwd)"
  pi install "$(cd "$d" && pwd)"
done

echo "pi install $ROOT"
pi install "$ROOT"

echo "bun run install:pi-assets"
bun run install:pi-assets

echo "Done. Restart pi.dev if it is already running."
