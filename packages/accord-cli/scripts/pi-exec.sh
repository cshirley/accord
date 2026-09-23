#!/usr/bin/env bash
# Thin wrapper — delegates to pi-exec.ts (pi --mode json -p subprocess spawns).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "${SCRIPT_DIR}/pi-exec.ts" "$@"
