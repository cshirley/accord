#!/usr/bin/env bash
# Register this repo with Pi (`pi install`) so `package.json` → `pi` loads the
# bundled extension modules (pi-subagent, pi-worktree, …) plus the ACCORD harness,
# then link bundled skills/agents/providers (`bun run install:assets`), and install
# a `~/.local/bin/accord` shim for headless CLI use from any directory.
#
# Usage:
#   scripts/install-dev.sh
#   scripts/install-dev.sh /path/to/other-package [/path/to/another ...]
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
if ! pi install "$ROOT"; then
  echo "error: pi install failed — check that 'pi' is on PATH and package.json pi.extensions paths exist" >&2
  exit 1
fi

echo "Linking Pi assets (install:assets --force)..."
if ! bun packages/pi-accord/scripts/install-assets.ts --force; then
  echo "error: install:assets failed" >&2
  exit 1
fi

echo "Installing accord shim (~/.local/bin/accord)..."
if ! bun packages/accord-cli/scripts/install-shim.ts --force; then
  echo "error: install:shim failed" >&2
  exit 1
fi

echo "Done. Restart pi.dev if it is already running."
