#!/usr/bin/env bash
# Trigger autopipeline-smoke.yml on GitHub using the current branch for workflow
# ref, base_branch, and accord_ref (pre-merge L4 check).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI is required (https://cli.github.com/)" >&2
  exit 1
fi

BRANCH="${SMOKE_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
TICKET="${SMOKE_TICKET:-DEMO-1}"
DRY_RUN="${SMOKE_DRY_RUN:-true}"
ACCORD_REF="${SMOKE_ACCORD_REF:-$BRANCH}"

echo "Triggering autopipeline-smoke.yml"
echo "  ref / base_branch / accord_ref: ${BRANCH} / ${BRANCH} / ${ACCORD_REF}"
echo "  ticket=${TICKET} dry_run=${DRY_RUN}"

gh workflow run autopipeline-smoke.yml \
  --ref "$BRANCH" \
  -f "ticket=${TICKET}" \
  -f "dry_run=${DRY_RUN}" \
  -f "base_branch=${BRANCH}" \
  -f "accord_ref=${ACCORD_REF}"

echo "Watch: gh run list --workflow=autopipeline-smoke.yml --limit 1 && gh run watch"
