#!/usr/bin/env bash
# Thin wrapper — delegates to claude-code-exec.ts (frontmatter → --model/--effort).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "${SCRIPT_DIR}/claude-code-exec.ts" "$@"
