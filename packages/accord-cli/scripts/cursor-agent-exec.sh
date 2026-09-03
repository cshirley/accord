#!/usr/bin/env bash
# Thin wrapper — delegates to cursor-agent-exec.ts (frontmatter → --model, body-only prompt).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "${SCRIPT_DIR}/cursor-agent-exec.ts" "$@"
