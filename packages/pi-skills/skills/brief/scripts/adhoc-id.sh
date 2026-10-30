#!/usr/bin/env bash
# Print the next free synthetic work item id: ADHOC-<YYYYMMDD><NN> (NN = 01..99).
# Same format as `accord bootstrap --adhoc` (accord-core work-items/synthetic.ts).
# An id is taken when `.tasks/<ID>.json` or `docs/dev/<ID>/` exists at the git root (or in the
# current directory outside a repository).
# Exit codes: 0 printed an id, 1 no free id today.

set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"
stamp="$(date +%Y%m%d)"
for sequence in $(seq 1 99); do
  candidate="$(printf 'ADHOC-%s%02d' "$stamp" "$sequence")"
  if [[ ! -e ".tasks/${candidate}.json" && ! -e "docs/dev/${candidate}" ]]; then
    echo "$candidate"
    exit 0
  fi
done

echo "adhoc-id: no free ADHOC-${stamp}NN id left today" >&2
exit 1
